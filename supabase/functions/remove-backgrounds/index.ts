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

interface ProcessingResult {
  name: string;
  originalData: string;
  backgroundRemovedData: string;
  size: number;
}

interface FailedResult {
  name: string;
  originalData: string;
  backgroundRemovedData: null;
  size: number;
  error: string;
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

    console.log(`Processing ${images.length} images for background removal`);

    // Process images in parallel with timeout to prevent CPU time exceeded errors
    const processImage = async (image: { data: string; name: string }, index: number) => {
      console.log(`Processing image ${index + 1}/${images.length}: ${image.name}`);
      console.log(`Image data length: ${image.data.length}`);

      // Create a timeout promise (60 seconds per image)
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Processing timeout after 60 seconds')), 60000);
      });

      // Create the API call promise
      const apiCallPromise = replicate.run(
        "851-labs/background-remover:a029dff38972b5fda4ec5d75d7d1cd25aeff621d2cf4946a41055d7db66b80bc",
        {
          input: {
            image: image.data,
            format: "png",
            background_type: "rgba"
          }
        }
      );

      // Race between timeout and API call
      const output = await Promise.race([apiCallPromise, timeoutPromise]);

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
          const buffer = output instanceof ArrayBuffer ? output : (output as Uint8Array).buffer;
          const base64Data = arrayBufferToBase64(buffer as ArrayBuffer);
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

        console.log(`Successfully removed background for ${image.name}, size: ${Math.round(size / 1024)}KB`);
        
        return {
          name: image.name,
          originalData: image.data,
          backgroundRemovedData: dataUrl,
          size: size
        };
      } else {
        console.error('No output received from Replicate API');
        throw new Error('No output received from Replicate API');
      }
    };

    // Process all images in parallel with individual error handling
    const imagePromises = images.map(async (image, index) => {
      try {
        return await processImage(image, index);
      } catch (error) {
        console.error(`Error processing ${image.name}:`, error);
        // Return error result instead of throwing to allow other images to continue
        return {
          name: image.name,
          originalData: image.data,
          backgroundRemovedData: null,
          size: 0,
          error: error instanceof Error ? error.message : String(error)
        };
      }
    });

    const results: (ProcessingResult | FailedResult)[] = await Promise.all(imagePromises);
    
    // Check if any images failed and separate successful from failed
    const successful = results.filter((result): result is ProcessingResult => !('error' in result));
    const failed = results.filter((result): result is FailedResult => 'error' in result);
    
    if (failed.length > 0) {
      console.warn(`${failed.length} images failed to process:`, failed.map(f => f.name));
    }
    
    if (successful.length === 0) {
      throw new Error('All images failed to process');
    }

    console.log(`Successfully processed ${successful.length} out of ${results.length} images`);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in remove-backgrounds function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to remove backgrounds', 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});