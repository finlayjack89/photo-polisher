import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLOUDINARY_CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME')!;

interface RenderRequest {
  backdropCloudinaryId: string;
  subjectCloudinaryId: string;
  position: {
    x: number;
    y: number;
  };
  scale: number;
  canvasWidth: number;
  canvasHeight: number;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { 
      backdropCloudinaryId, 
      subjectCloudinaryId, 
      position, 
      scale,
      canvasWidth,
      canvasHeight 
    } = await req.json() as RenderRequest;

    console.log('Rendering final composite:', { backdropCloudinaryId, subjectCloudinaryId, position, scale });

    // Calculate pixel positions
    const subjectCenterX = Math.round(position.x * canvasWidth);
    const subjectCenterY = Math.round(position.y * canvasHeight);
    const subjectWidth = Math.round(canvasWidth * scale);
    
    // Cloudinary offsets from center
    const xOffset = subjectCenterX - (canvasWidth / 2);
    const yOffset = subjectCenterY - (canvasHeight / 2);
    
    // Calculate floor baseline (bottom of subject)
    // First get subject dimensions to calculate bottom
    const subjectHeight = Math.round(subjectWidth * 0.6); // Approximate aspect ratio
    const floorY = subjectCenterY + (subjectHeight / 2);

    // Build comprehensive transformation with shadows and reflection
    const transformations = [
      // 1. Set canvas
      `w_${canvasWidth},h_${canvasHeight},c_limit,b_white,f_png`,
      
      // 2. Add slight backdrop blur
      `e_blur:400`,
      
      // 3. Add ground shadow (soft, elongated)
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},e_colorize:100,co_rgb:000000,o_16,e_blur:68,g_center,x_${xOffset},y_${floorY - canvasHeight/2 + 20},fl_layer_apply`,
      
      // 4. Add contact shadow (sharp, close to product)
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},e_colorize:100,co_rgb:000000,o_45,e_blur:32,g_center,x_${xOffset},y_${yOffset + 6},fl_layer_apply`,
      
      // 5. Add reflection (flipped vertically, faded)
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},a_vflip,o_30,e_blur:6,g_center,x_${xOffset},y_${floorY - canvasHeight/2 + subjectHeight/2 + 12},fl_layer_apply,e_gradient_fade:65`,
      
      // 6. Overlay main subject on top
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},g_center,x_${xOffset},y_${yOffset},fl_layer_apply`,
    ].join('/');

    const finalUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${transformations}/${backdropCloudinaryId}`;

    console.log('Generated final URL:', finalUrl);

    return new Response(
      JSON.stringify({ 
        url: finalUrl,
        success: true 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Error rendering composite:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500 
      }
    );
  }
});
