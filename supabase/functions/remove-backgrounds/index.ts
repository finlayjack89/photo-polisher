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
        // Use Bria Background Remove model
        const output = await replicate.run(
          "bria/remove-background:ce41b9f4f35c1c0d8df9bb1825a44fcd2b96a2a6db7b6f3db2b87a5e4efd1f0e",
          {
            input: {
              image: image.data
            }
          }
        );

        // The output should be a URL to the processed image
        if (output && typeof output === 'string') {
          // Download the image from the URL and convert to base64
          const imageResponse = await fetch(output);
          const imageBuffer = await imageResponse.arrayBuffer();
          const base64Data = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));
          const dataUrl = `data:image/png;base64,${base64Data}`;

          results.push({
            name: image.name,
            originalData: image.data,
            backgroundRemovedData: dataUrl,
            size: imageBuffer.byteLength
          });
          
          console.log(`Successfully removed background for ${image.name}, size: ${Math.round(imageBuffer.byteLength / 1024)}KB`);
        } else {
          throw new Error('Invalid response from Replicate API');
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