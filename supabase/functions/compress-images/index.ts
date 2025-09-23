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
    const TINIFY_API_KEY = Deno.env.get('TINIFY_API_KEY');
    if (!TINIFY_API_KEY) {
      throw new Error('TINIFY_API_KEY is not configured');
    }

    const { files } = await req.json();
    console.log(`Processing ${files.length} images for compression`);

    const compressedFiles = [];

    for (const file of files) {
      console.log(`Compressing image: ${file.originalName || file.name}`);
      
      try {
        // Convert base64 to buffer for Tinify API
        const imageBuffer = Uint8Array.from(atob(file.data), c => c.charCodeAt(0));
        
        // Call Tinify API for compression
        const response = await fetch('https://api.tinify.com/shrink', {
          method: 'POST',
          headers: {
            'Authorization': `Basic ${btoa(`api:${TINIFY_API_KEY}`)}`,
            'Content-Type': 'application/octet-stream',
          },
          body: imageBuffer,
        });

        if (!response.ok) {
          const errorText = await response.text();
          console.error(`Tinify API error for ${file.originalName || file.name}:`, response.status, errorText);
          // If compression fails, use original image
          compressedFiles.push({
            originalName: file.originalName || file.name,
            processedName: `compressed_${file.originalName || file.name}`,
            data: file.data,
            size: file.size || 0,
            format: file.format || 'png'
          });
          continue;
        }

        const result = await response.json();
        
        // Download the compressed image
        const compressedResponse = await fetch(result.output.url);
        const compressedBuffer = await compressedResponse.arrayBuffer();
        const compressedBase64 = btoa(String.fromCharCode(...new Uint8Array(compressedBuffer)));
        
        compressedFiles.push({
          originalName: file.originalName || file.name,
          processedName: `compressed_${file.originalName || file.name}`,
          data: compressedBase64,
          size: result.output.size,
          format: file.format || 'png',
          compressionRatio: `${Math.round((1 - result.output.ratio) * 100)}% smaller`
        });

        console.log(`Successfully compressed: ${file.originalName || file.name} (${result.output.size} bytes, ${Math.round((1 - result.output.ratio) * 100)}% reduction)`);
      } catch (error) {
        console.error(`Error compressing ${file.originalName || file.name}:`, error);
        // If compression fails, use original image
        compressedFiles.push({
          originalName: file.originalName || file.name,
          processedName: `compressed_${file.originalName || file.name}`,
          data: file.data,
          size: file.size || 0,
          format: file.format || 'png'
        });
      }
    }

    return new Response(JSON.stringify({
      success: true,
      compressedFiles
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in compress-images function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error.message
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});