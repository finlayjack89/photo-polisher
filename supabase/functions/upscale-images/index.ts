import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SWINIR_API_KEY = Deno.env.get('SWINIR_API_KEY');
    if (!SWINIR_API_KEY) {
      throw new Error('SWINIR_API_KEY is not configured');
    }

    const { files } = await req.json();
    console.log(`Processing ${files.length} images for upscaling`);

    const upscaledFiles = [];

    for (const file of files) {
      console.log(`Upscaling image: ${file.name}`);
      
      try {
        // Use Replicate API for upscaling (more reliable than SwinIR)
        const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY');
        if (!REPLICATE_API_KEY) {
          throw new Error('REPLICATE_API_KEY is not configured');
        }

        const response = await fetch('https://api.replicate.com/v1/predictions', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${REPLICATE_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            version: "f121d640bd286e1fdc67f9799164c1d5be36ff74576ee11c803ae5b665dd46aa", // Working Real-ESRGAN model version
            input: {
              image: file.data.startsWith('data:') ? file.data : `data:image/png;base64,${file.data}`,
              scale: 2 // Maximum 2x (100% increase) to retain original texture
            }
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Replicate API error for ${file.name}:`, response.status, errorText);
          // If upscaling fails, use original image
          upscaledFiles.push({
            originalName: file.name,
            processedName: `upscaled_${file.name}`,
            data: file.data,
            size: file.size || 0,
            format: file.type?.split('/')[1] || 'png'
          });
          continue;
        }

        const prediction = await response.json();
        
        // Wait for completion
        let status = prediction.status;
        let predictionId = prediction.id;
        
        while (status === 'starting' || status === 'processing') {
          await new Promise(resolve => setTimeout(resolve, 2000));
          
          const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${predictionId}`, {
            headers: {
              'Authorization': `Token ${REPLICATE_API_KEY}`,
            },
          });
          
          const statusResult = await statusResponse.json();
          status = statusResult.status;
          
          if (status === 'succeeded' && statusResult.output) {
            // Fetch the upscaled image
            const imageResponse = await fetch(statusResult.output);
            const imageBuffer = await imageResponse.arrayBuffer();
            
            // Convert ArrayBuffer to base64 more efficiently to avoid stack overflow
            const uint8Array = new Uint8Array(imageBuffer);
            let binaryString = '';
            const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
            
            for (let i = 0; i < uint8Array.length; i += chunkSize) {
              const chunk = uint8Array.subarray(i, i + chunkSize);
              binaryString += String.fromCharCode.apply(null, Array.from(chunk));
            }
            
            const base64Data = btoa(binaryString);
            
            upscaledFiles.push({
              originalName: file.name,
              processedName: `upscaled_${file.name}`,
              data: base64Data,
              size: imageBuffer.byteLength,
              format: 'png'
            });
            break;
          } else if (status === 'failed' || status === 'canceled') {
            console.error(`Upscaling failed for ${file.name}:`, statusResult.error);
            // Use original image as fallback
            upscaledFiles.push({
              originalName: file.name,
              processedName: `upscaled_${file.name}`,
              data: file.data,
              size: file.size || 0,
              format: file.type?.split('/')[1] || 'png'
            });
            break;
          }
        }

        console.log(`Successfully upscaled: ${file.name}`);
      } catch (error) {
        console.error(`Error upscaling ${file.name}:`, error);
        // If upscaling fails, use original image
        upscaledFiles.push({
          originalName: file.name,
          processedName: `upscaled_${file.name}`,
          data: file.data,
          size: file.size || 0,
          format: file.type?.split('/')[1] || 'png'
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      upscaledFiles
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in upscale-images function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});