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

    // Simple transformation: backdrop fills canvas, subject overlaid at exact position
    const transformations = [
      // 1. Set canvas - backdrop fills entire frame
      `w_${canvasWidth},h_${canvasHeight},c_fill,f_png`,
      
      // 2. Overlay subject at user-specified position (matching preview exactly)
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
