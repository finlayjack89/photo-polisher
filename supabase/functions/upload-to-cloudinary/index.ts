import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLOUDINARY_CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME');
const CLOUDINARY_API_KEY = Deno.env.get('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET');

interface UploadRequest {
  image_data_url: string;
  folder: string;
  public_id?: string;
  type: 'bag' | 'backdrop';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { image_data_url, folder, public_id, type }: UploadRequest = await req.json();
    
    console.log('Upload request received:', { 
      folder, 
      public_id: public_id || 'auto-generated',
      type,
      data_url_length: image_data_url?.length 
    });

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      throw new Error('Cloudinary credentials not configured');
    }

    // Upload to Cloudinary
    const formData = new FormData();
    formData.append('file', image_data_url);
    formData.append('upload_preset', 'ml_default');
    if (folder) formData.append('folder', folder);
    if (public_id) formData.append('public_id', public_id);
    
    // Sign the upload
    const timestamp = Math.floor(Date.now() / 1000);
    const params: Record<string, string> = {
      timestamp: timestamp.toString(),
    };
    if (folder) params.folder = folder;
    if (public_id) params.public_id = public_id;
    
    // Create signature
    const paramsString = Object.keys(params)
      .sort()
      .map(key => `${key}=${params[key]}`)
      .join('&');
    
    const encoder = new TextEncoder();
    const data = encoder.encode(paramsString + CLOUDINARY_API_SECRET);
    const hashBuffer = await crypto.subtle.digest('SHA-1', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const signature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    formData.append('api_key', CLOUDINARY_API_KEY);
    formData.append('timestamp', timestamp.toString());
    formData.append('signature', signature);

    const uploadUrl = `https://api.cloudinary.com/v1_1/${CLOUDINARY_CLOUD_NAME}/image/upload`;
    
    console.log('Uploading to Cloudinary...');
    const response = await fetch(uploadUrl, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      const error = await response.text();
      console.error('Cloudinary upload error:', error);
      throw new Error(`Cloudinary upload failed: ${error}`);
    }

    const result = await response.json();
    
    console.log('Upload successful:', {
      public_id: result.public_id,
      version: result.version,
      width: result.width,
      height: result.height,
    });

    return new Response(
      JSON.stringify({
        public_id: result.public_id,
        version: result.version,
        width: result.width,
        height: result.height,
        secure_url: result.secure_url,
        format: result.format,
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in upload-to-cloudinary:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
