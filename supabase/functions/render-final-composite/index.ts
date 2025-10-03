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

    // Build transformation: backdrop fills canvas, then add shadows/reflection, then subject
    const transformations = [
      // 1. Set canvas - backdrop fills entire frame
      `w_${canvasWidth},h_${canvasHeight},c_fill,f_png`,
      
      // 2. Add ground shadow (soft black shadow below product)
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},e_colorize:100,co_rgb:000000,o_20,e_blur:80,e_distort:0:0:${subjectWidth}:0:${subjectWidth*1.2}:${subjectHeight}:0:${subjectHeight},g_center,x_${xOffset},y_${floorY - canvasHeight/2},fl_layer_apply`,
      
      // 3. Add contact shadow (sharp shadow directly under product)
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},e_colorize:100,co_rgb:000000,o_35,e_blur:20,g_center,x_${xOffset},y_${yOffset + Math.round(subjectHeight * 0.4)},fl_layer_apply`,
      
      // 4. Add single reflection (vertically flipped, faded from bottom)
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},a_vflip,o_25,e_blur:4,g_center,x_${xOffset},y_${floorY - canvasHeight/2 + Math.round(subjectHeight * 0.8)},fl_layer_apply/e_gradient_fade:symmetric:20`,
      
      // 5. Overlay main subject on top (exact position from preview)
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
