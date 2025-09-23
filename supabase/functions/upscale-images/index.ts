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
        // Call SwinIR API for upscaling
        const response = await fetch('https://api.swinir.ai/v1/upscale', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${SWINIR_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image: file.data,
            scale: 2, // 2x upscaling
            model: 'real-world', // Use real-world model for photos
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`SwinIR API error for ${file.name}:`, response.status, errorText);
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

        const result = await response.json();
        
        upscaledFiles.push({
          originalName: file.name,
          processedName: `upscaled_${file.name}`,
          data: result.upscaled_image,
          size: result.size || file.size || 0,
          format: file.type?.split('/')[1] || 'png'
        });

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
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});