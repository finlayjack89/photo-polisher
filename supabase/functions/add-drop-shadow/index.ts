import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to resize base64 images to prevent shadow cropping
async function resizeImage(base64Data: string, maxDimension: number = 1000): Promise<string> {
  try {
    // Extract base64 content without data URL prefix
    const base64Content = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    
    // Decode base64 to binary
    const binaryString = atob(base64Content);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    
    // Create a blob and read as data URL for processing
    const blob = new Blob([bytes], { type: 'image/png' });
    
    // Use canvas API to resize (available in Deno with canvas module)
    // For now, we'll return original if dimensions are reasonable
    // This is a simplified approach - full implementation would use canvas
    console.log(`Image size: ${blob.size} bytes - resizing to max ${maxDimension}px`);
    
    // Return original base64 (in production, this would resize using canvas)
    // The key insight is that Cloudinary will handle the transformation
    // We're mainly ensuring the padding calculation is correct
    return base64Data;
  } catch (error) {
    console.error('Error resizing image:', error);
    return base64Data; // Return original on error
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images, uploadPreview, image, azimuth = 0, elevation = 90, spread = 5 } = await req.json();
    
    const cloudName = Deno.env.get('CLOUDINARY_CLOUD_NAME');
    const apiKey = Deno.env.get('CLOUDINARY_API_KEY');
    const apiSecret = Deno.env.get('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error('Cloudinary credentials not configured');
    }

    // Handle preview upload request
    if (uploadPreview && image) {
      console.log('Uploading preview image to Cloudinary...');
      
      const timestamp = Math.floor(Date.now() / 1000);
      const folder = 'shadow_preview_temp';
      const signatureString = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
      const uploadSignature = await generateSignature(signatureString, apiSecret);

      const uploadData = new FormData();
      uploadData.append('file', image.data);
      uploadData.append('api_key', apiKey);
      uploadData.append('timestamp', timestamp.toString());
      uploadData.append('signature', uploadSignature);
      uploadData.append('folder', folder);

      const uploadResponse = await fetch(
        `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
        {
          method: 'POST',
          body: uploadData,
        }
      );

      if (!uploadResponse.ok) {
        const errorText = await uploadResponse.text();
        throw new Error(`Preview upload failed: ${uploadResponse.status} - ${errorText}`);
      }

      const uploadResult = await uploadResponse.json();
      console.log('✅ Preview uploaded:', uploadResult.public_id);

      return new Response(
        JSON.stringify({ 
          success: true, 
          publicId: uploadResult.public_id,
          cloudName: cloudName 
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided');
    }

    console.log(`Processing ${images.length} images for drop shadow with params: azimuth=${azimuth}, elevation=${elevation}, spread=${spread}`);

    const processedImages = [];

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      console.log(`Processing image ${i + 1}/${images.length}: ${image.name}`);

      try {
        // Generate timestamp and signature for authenticated upload
        const timestamp = Math.floor(Date.now() / 1000);
        const folder = 'drop_shadow_temp';
        const signatureString = `folder=${folder}&timestamp=${timestamp}${apiSecret}`;
        const uploadSignature = await generateSignature(signatureString, apiSecret);

        // Upload to Cloudinary with authentication
        const uploadData = new FormData();
        uploadData.append('file', image.data);
        uploadData.append('api_key', apiKey);
        uploadData.append('timestamp', timestamp.toString());
        uploadData.append('signature', uploadSignature);
        uploadData.append('folder', folder);

        console.log(`Uploading ${image.name} to Cloudinary with signed upload...`);

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
          throw new Error(`Upload failed: ${uploadResponse.status} - ${errorText}`);
        }

        const uploadResult = await uploadResponse.json();
        console.log(`✅ Uploaded ${image.name} to Cloudinary:`, uploadResult.public_id);

        // Calculate aggressive padding based on spread to ensure shadow never gets cropped
        // Minimum 400px (200px per side), scales up dramatically with spread
        const padding = Math.max(400, spread * 50);
        console.log(`Using padding: ${padding}px for spread: ${spread}`);
        
        // Apply padding BEFORE drop shadow transformation
        // c_pad: Expand canvas first with transparent background
        // Then e_dropshadow: Apply shadow effect to the expanded canvas
        const transformedUrl = `https://res.cloudinary.com/${cloudName}/image/upload/c_pad,w_iw_add_${padding},h_ih_add_${padding},b_transparent/e_dropshadow:azimuth_${azimuth};elevation_${elevation};spread_${spread}/${uploadResult.public_id}.png`;
        
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
          const deleteTimestamp = Math.floor(Date.now() / 1000);
          const deleteSignatureString = `public_id=${uploadResult.public_id}&timestamp=${deleteTimestamp}${apiSecret}`;
          const deleteSignature = await generateSignature(deleteSignatureString, apiSecret);
          
          const deleteData = new FormData();
          deleteData.append('public_id', uploadResult.public_id);
          deleteData.append('signature', deleteSignature);
          deleteData.append('api_key', apiKey);
          deleteData.append('timestamp', deleteTimestamp.toString());

          const deleteResponse = await fetch(
            `https://api.cloudinary.com/v1_1/${cloudName}/image/destroy`,
            {
              method: 'POST',
              body: deleteData,
            }
          );
          
          if (deleteResponse.ok) {
            console.log(`🗑️ Cleaned up temporary Cloudinary image: ${uploadResult.public_id}`);
          }
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

async function generateSignature(stringToSign: string, apiSecret: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(stringToSign);
  const hashBuffer = await crypto.subtle.digest('SHA-1', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}
