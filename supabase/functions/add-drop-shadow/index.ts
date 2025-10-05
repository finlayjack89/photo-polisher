import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images } = await req.json();
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided');
    }

    console.log(`Processing ${images.length} images for drop shadow`);

    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials not configured');
    }

    const processedImages = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      console.log(`Processing image ${i + 1}/${images.length}: ${image.name}`);

      try {
        // Upload to Cloudinary
        const uploadData = new FormData();
        uploadData.append('file', image.data);
        uploadData.append('upload_preset', 'unsigned_preset');
        uploadData.append('api_key', apiKey);

        const uploadResponse = await fetch(
          `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
          {
            method: 'POST',
            body: uploadData,
          }
        );

        if (!uploadResponse.ok) {
          const errorText = await uploadResponse.text();
          console.error(`Upload failed for ${image.name}:`, errorText);
          throw new Error(`Upload failed: ${uploadResponse.status}`);
        }

        const uploadResult = await uploadResponse.json();
        console.log(`Uploaded ${image.name} to Cloudinary:`, uploadResult.public_id);

        // Apply drop shadow transformation
        // e_dropshadow:azimuth_0;elevation_90;spread_5
        const transformedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/e_dropshadow:azimuth_0;elevation_90;spread_5/${uploadResult.public_id}.png`;
        
        console.log(`Transformation URL: ${transformedUrl}`);

        // Fetch the transformed image
        const transformedResponse = await fetch(transformedUrl);
        
        if (!transformedResponse.ok) {
          throw new Error(`Failed to fetch transformed image: ${transformedResponse.status}`);
        }

        const transformedBlob = await transformedResponse.blob();
        const arrayBuffer = await transformedBlob.arrayBuffer();
        const base64 = btoa(
          new Uint8Array(arrayBuffer).reduce(
            (data, byte) => data + String.fromCharCode(byte),
            ''
          )
        );
        
        const shadowedDataUrl = `data:image/png;base64,${base64}`;
        
        processedImages.push({
          name: image.name,
          shadowedData: shadowedDataUrl,
        });

        console.log(`✅ Successfully added shadow to ${image.name}`);

        // Clean up: Delete from Cloudinary after processing
        try {
          const timestamp = Math.floor(Date.now() / 1000);
          const signature = await generateSignature(uploadResult.public_id, timestamp, apiSecret);
          
          const deleteData = new FormData();
          deleteData.append('public_id', uploadResult.public_id);
          deleteData.append('signature', signature);
          deleteData.append('api_key', apiKey);
          deleteData.append('timestamp', timestamp.toString());

          await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
            {
              method: 'POST',
              body: deleteData,
            }
          );
          console.log(`Cleaned up temporary Cloudinary image: ${uploadResult.public_id}`);
        } catch (cleanupError) {
          console.warn('Failed to cleanup Cloudinary image:', cleanupError);
        }

      } catch (imageError) {
        console.error(`Failed to process ${image.name}:`, imageError);
        // Return original image if shadow generation fails
        processedImages.push({
          name: image.name,
          shadowedData: image.data,
          error: imageError.message,
        });
      }
    }

    return new Response(
      JSON.stringify({ success: true, images: processedImages }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in add-drop-shadow function:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function generateSignature(publicId: string, timestamp: number, apiSecret: string): Promise<string> {
  const stringToSign = `public_id=${publicId}&timestamp=${timestamp}${apiSecret}`;
  const encoder = new TextEncoder();
  const data = encoder.encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
