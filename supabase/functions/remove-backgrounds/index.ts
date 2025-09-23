import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Replicate from "https://esm.sh/replicate@0.25.2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BackgroundRemovalRequest {
  images: Array<{
    data: string; // base64 image data
    name: string;
  }>;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images }: BackgroundRemovalRequest = await req.json();
    
    const apiKey = Deno.env.get('REPLICATE_API_KEY');
    if (!apiKey) {
      throw new Error('REPLICATE_API_KEY not found');
    }

    const replicate = new Replicate({
      auth: apiKey,
    });

    const results = [];

    console.log(`Processing ${images.length} images for background removal`);

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      console.log(`Processing image ${i + 1}/${images.length}: ${image.name}`);

      try {
        console.log(`Image data length: ${image.data.length}`);
        
        // Use Bria Background Remove model
        const output = await replicate.run(
          "bria/remove-background",
          {
            input: {
              image: image.data
            }
          }
        );

        console.log(`Replicate output type: ${typeof output}`);
        console.log(`Replicate output:`, output);

        // The output should be the processed image data
        if (output) {
          let dataUrl;
          
          // Helper function to convert ArrayBuffer to base64 without stack overflow
          const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
            const bytes = new Uint8Array(buffer);
            let binary = '';
            const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
            
            for (let i = 0; i < bytes.length; i += chunkSize) {
              const chunk = bytes.subarray(i, i + chunkSize);
              binary += String.fromCharCode(...chunk);
            }
            
            return btoa(binary);
          };

          // Handle different response formats
          if (typeof output === 'string' && output.startsWith('http')) {
            console.log('Processing URL response');
            // If it's a URL, fetch the image
            const imageResponse = await fetch(output);
            const imageBuffer = await imageResponse.arrayBuffer();
            const base64Data = arrayBufferToBase64(imageBuffer);
            dataUrl = `data:image/png;base64,${base64Data}`;
          } else if (typeof output === 'string' && output.startsWith('data:')) {
            console.log('Processing data URL response');
            // If it's already a data URL
            dataUrl = output;
          } else if (output instanceof ArrayBuffer || output instanceof Uint8Array) {
            console.log('Processing binary data response');
            // If it's binary data
            const buffer = output instanceof ArrayBuffer ? output : output.buffer;
            const base64Data = arrayBufferToBase64(buffer);
            dataUrl = `data:image/png;base64,${base64Data}`;
          } else if (Array.isArray(output) && output.length > 0) {
            console.log('Processing array response, using first item');
            // Some models return an array with the first item being the URL
            const firstOutput = output[0];
            if (typeof firstOutput === 'string' && firstOutput.startsWith('http')) {
              const imageResponse = await fetch(firstOutput);
              const imageBuffer = await imageResponse.arrayBuffer();
              const base64Data = arrayBufferToBase64(imageBuffer);
              dataUrl = `data:image/png;base64,${base64Data}`;
            } else {
              dataUrl = firstOutput;
            }
          } else {
            console.error(`Unexpected output format: ${typeof output}`, output);
            throw new Error(`Unexpected output format: ${typeof output}`);
          }

          // Calculate size for data URLs
          const base64Part = dataUrl.split(',')[1];
          const size = base64Part ? Math.floor((base64Part.length * 3) / 4) : 0;

          results.push({
            name: image.name,
            originalData: image.data,
            backgroundRemovedData: dataUrl,
            size: size
          });
          
          console.log(`Successfully removed background for ${image.name}, size: ${Math.round(size / 1024)}KB`);
        } else {
          console.error('No output received from Replicate API');
          throw new Error('No output received from Replicate API');
        }
      } catch (error) {
        console.error(`Error processing ${image.name}:`, error);
        throw new Error(`Failed to remove background for ${image.name}: ${error.message}`);
      }
    }

    console.log(`Successfully processed all ${results.length} images`);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in remove-backgrounds function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to remove backgrounds', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});