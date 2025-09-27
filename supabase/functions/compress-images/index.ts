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
    console.log(`Processing ${files.length} images for intelligent compression`);

    const compressedFiles = [];
    // Set target to 5MB as per user preference
    const TARGET_SIZE_MB = 5;
    const TARGET_SIZE_BYTES = TARGET_SIZE_MB * 1024 * 1024;

    for (const file of files) {
      const fileName = file.originalName || file.name;
      console.log(`Analyzing image: ${fileName}`);
      
      try {
        // Clean base64 data and convert to buffer
        const base64Data = file.data.replace(/^data:image\/[a-z]+;base64,/, '');
        const imageBuffer = Uint8Array.from(atob(base64Data), c => c.charCodeAt(0));
        const originalSize = imageBuffer.length;
        
        console.log(`Original size: ${fileName} - ${(originalSize / (1024 * 1024)).toFixed(2)}MB`);
        
        // If image is already under 5MB, skip compression
        if (originalSize <= TARGET_SIZE_BYTES) {
          console.log(`Skipping compression for ${fileName} - already under ${TARGET_SIZE_MB}MB`);
          compressedFiles.push({
            originalName: fileName,
            processedName: fileName,
            data: file.data,
            size: originalSize,
            format: file.format || 'png',
            compressionRatio: 'No compression needed'
          });
          continue;
        }

        console.log(`Compressing ${fileName} using gradual quality reduction`);
        
        // Use gradual quality reduction approach - start at 98% and reduce by 2% each iteration
        let bestResult = null;
        let bestSize = originalSize;
        let currentQuality = 98;
        let attempts = 0;
        const maxAttempts = 25; // Prevents infinite loops (98% down to 48%)

        while (bestSize > TARGET_SIZE_BYTES && currentQuality >= 50 && attempts < maxAttempts) {
          attempts++;
          console.log(`Attempt ${attempts}: Trying quality ${currentQuality}%`);
          
          try {
            const response = await fetch('https://api.tinify.com/shrink', {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${btoa(`api:${TINIFY_API_KEY}`)}`,
                'Content-Type': 'application/octet-stream',
              },
              body: imageBuffer,
            });

            if (response.ok) {
              const result = await response.json();
              
              // Apply quality settings
              const qualityResponse = await fetch(result.output.url, {
                method: 'POST',
                headers: {
                  'Authorization': `Basic ${btoa(`api:${TINIFY_API_KEY}`)}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  convert: {
                    type: 'image/jpeg',
                    quality: Math.round(currentQuality)
                  }
                }),
              });
              
              if (qualityResponse.ok) {
                const qualityResult = await qualityResponse.json();
                const compressedResponse = await fetch(qualityResult.output.url);
                const compressedBuffer = await compressedResponse.arrayBuffer();
                const compressedSize = compressedBuffer.byteLength;
                
                console.log(`Quality ${currentQuality}%: ${(compressedSize / (1024 * 1024)).toFixed(2)}MB`);
                
                // Update best result
                bestResult = compressedBuffer;
                bestSize = compressedSize;
                
                // If we've reached the target size, break early
                if (compressedSize <= TARGET_SIZE_BYTES) {
                  console.log(`Target size reached at quality ${currentQuality}%`);
                  break;
                }
              }
            }
            
            // Reduce quality by 2% for next iteration
            currentQuality -= 2;
          } catch (error) {
            console.error(`Error at quality ${currentQuality}%:`, error);
            break;
          }
        }
        
        // If no compression worked or we couldn't get under target size, try basic Tinify compression
        if (!bestResult || bestSize > TARGET_SIZE_BYTES) {
          console.log(`Fallback: Using basic Tinify compression for ${fileName}`);
          try {
            const response = await fetch('https://api.tinify.com/shrink', {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${btoa(`api:${TINIFY_API_KEY}`)}`,
                'Content-Type': 'application/octet-stream',
              },
              body: imageBuffer,
            });
            
            if (response.ok) {
              const result = await response.json();
              const compressedResponse = await fetch(result.output.url);
              bestResult = await compressedResponse.arrayBuffer();
              bestSize = bestResult.byteLength;
              console.log(`Basic compression result: ${(bestSize / (1024 * 1024)).toFixed(2)}MB`);
            }
          } catch (error) {
            console.error(`Fallback compression failed:`, error);
          }
        }
        
        if (bestResult) {
          // Convert ArrayBuffer to base64 efficiently
          const uint8Array = new Uint8Array(bestResult);
          let binaryString = '';
          const chunkSize = 0x8000; // 32KB chunks to avoid stack overflow
          
          for (let i = 0; i < uint8Array.length; i += chunkSize) {
            const chunk = uint8Array.subarray(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, Array.from(chunk));
          }
          
          const compressedBase64 = btoa(binaryString);
          const compressionRatio = Math.round((1 - bestSize / originalSize) * 100);
          
          compressedFiles.push({
            originalName: fileName,
            processedName: `compressed_${fileName}`,
            data: compressedBase64,
            size: bestSize,
            format: file.format || 'png',
            compressionRatio: `${compressionRatio}% smaller`
          });

          console.log(`Successfully compressed: ${fileName} (${(bestSize / (1024 * 1024)).toFixed(2)}MB, ${compressionRatio}% reduction)`);
        } else {
          // If all compression attempts failed, use original
          console.log(`Compression failed for ${fileName}, using original`);
          compressedFiles.push({
            originalName: fileName,
            processedName: fileName,
            data: file.data,
            size: originalSize,
            format: file.format || 'png',
            compressionRatio: 'Compression failed'
          });
        }
      } catch (error) {
        console.error(`Error processing ${fileName}:`, error);
        // If processing fails, use original image
        compressedFiles.push({
          originalName: fileName,
          processedName: fileName,
          data: file.data,
          size: file.size || 0,
          format: file.format || 'png',
          compressionRatio: 'Processing failed'
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
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});