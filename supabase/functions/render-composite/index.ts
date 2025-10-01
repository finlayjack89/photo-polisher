import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLOUDINARY_CLOUD_NAME = Deno.env.get('CLOUDINARY_CLOUD_NAME');
const CLOUDINARY_API_KEY = Deno.env.get('CLOUDINARY_API_KEY');
const CLOUDINARY_API_SECRET = Deno.env.get('CLOUDINARY_API_SECRET');

interface RenderRequest {
  bag_public_id: string;
  backdrop_public_id: string;
  canvas: {
    w: number;
    h: number;
    format: string;
  };
  placement: {
    mode: string;
    x: string;
    y_baseline_px: number;
    rotation_deg: number;
  };
  shadow: {
    contact: {
      opacity: number;
      radius_px: number;
      offset_y_px: number;
    };
    ground: {
      opacity: number;
      radius_px: number;
      elongation_y: number;
    };
  };
  reflection: {
    enabled: boolean;
    opacity: number;
    fade_pct: number;
    blur_px: number;
    offset_y_px: number;
  };
  backdrop_fx: {
    wall_blur_px: number;
  };
  safeguards: {
    preserve_subject_pixels: boolean;
    no_auto_color_subject: boolean;
    fit_entire_subject: boolean;
  };
  image_id?: string;
  store_derived?: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const startTime = Date.now();
    const requestData: RenderRequest = await req.json();
    
    console.log('Render request received:', {
      bag_public_id: requestData.bag_public_id,
      backdrop_public_id: requestData.backdrop_public_id,
      canvas: requestData.canvas,
    });

    if (!CLOUDINARY_CLOUD_NAME || !CLOUDINARY_API_KEY || !CLOUDINARY_API_SECRET) {
      throw new Error('Cloudinary credentials not configured');
    }

    // Build Cloudinary transformation URL
    const transformations = buildCloudinaryTransformation(requestData);
    const cloudinaryUrl = `https://res.cloudinary.com/${CLOUDINARY_CLOUD_NAME}/image/upload/${transformations}/${requestData.backdrop_public_id}`;
    
    console.log('Generated Cloudinary URL:', cloudinaryUrl);

    // Store render params if image_id provided
    if (requestData.image_id) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);

      const { error } = await supabase
        .from('batch_images')
        .update({ 
          render_params: {
            bag_public_id: requestData.bag_public_id,
            backdrop_public_id: requestData.backdrop_public_id,
            canvas: requestData.canvas,
            placement: requestData.placement,
            shadow: requestData.shadow,
            reflection: requestData.reflection,
            backdrop_fx: requestData.backdrop_fx,
          }
        })
        .eq('id', requestData.image_id);

      if (error) {
        console.error('Error storing render params:', error);
      }
    }

    const renderTime = Date.now() - startTime;
    console.log(`Render completed in ${renderTime}ms`);

    return new Response(
      JSON.stringify({
        url: cloudinaryUrl,
        render_time_ms: renderTime,
        params_hash: generateParamsHash(requestData),
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  } catch (error) {
    console.error('Error in render-composite:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});

function buildCloudinaryTransformation(params: RenderRequest): string {
  const { canvas, placement, shadow, reflection, backdrop_fx, bag_public_id } = params;
  const transformations: string[] = [];

  // Base canvas setup
  transformations.push(`w_${canvas.w},h_${canvas.h},c_fill,f_${canvas.format}`);

  // Apply backdrop blur if specified
  if (backdrop_fx.wall_blur_px > 0) {
    transformations.push(`e_blur:${backdrop_fx.wall_blur_px * 100}`);
  }

  // Calculate bag placement
  const yPosition = Math.round((placement.y_baseline_px / canvas.h) * 100);
  
  // Overlay the bag (subject) - preserved, no alterations
  const bagOverlay = [
    `l_${bag_public_id.replace(/\//g, ':')}`,
    'fl_layer_apply',
    placement.mode === 'fit_entire_subject' ? 'c_fit' : 'c_scale',
    `w_${Math.round(canvas.w * 0.8)}`, // Auto-fit to 80% of canvas width
    `g_south`,
    `y_${canvas.h - placement.y_baseline_px}`,
  ];

  if (placement.rotation_deg !== 0) {
    bagOverlay.push(`a_${placement.rotation_deg}`);
  }

  transformations.push(bagOverlay.join(','));

  // Add contact shadow (dense perimeter)
  if (shadow.contact.opacity > 0) {
    const contactShadow = [
      `l_${bag_public_id.replace(/\//g, ':')}`,
      'e_colorize:100,co_rgb:000000',
      `o_${Math.round(shadow.contact.opacity * 100)}`,
      `e_blur:${shadow.contact.radius_px * 10}`,
      `y_${canvas.h - placement.y_baseline_px + shadow.contact.offset_y_px}`,
      'fl_layer_apply',
    ];
    transformations.push(contactShadow.join(','));
  }

  // Add ground shadow (elongated)
  if (shadow.ground.opacity > 0) {
    const groundShadow = [
      `l_${bag_public_id.replace(/\//g, ':')}`,
      'e_colorize:100,co_rgb:000000',
      `o_${Math.round(shadow.ground.opacity * 100)}`,
      `e_blur:${shadow.ground.radius_px * 10}`,
      `h_${Math.round(canvas.h * shadow.ground.elongation_y * 0.3)}`,
      `y_${canvas.h - placement.y_baseline_px}`,
      'fl_layer_apply',
    ];
    transformations.push(groundShadow.join(','));
  }

  // Add reflection
  if (reflection.enabled && reflection.opacity > 0) {
    const reflectionOverlay = [
      `l_${bag_public_id.replace(/\//g, ':')}`,
      'a_vflip', // Vertical flip
      `o_${Math.round(reflection.opacity * 100)}`,
      `e_blur:${reflection.blur_px * 10}`,
      `e_gradient_fade:${reflection.fade_pct}`,
      `y_${canvas.h - placement.y_baseline_px - reflection.offset_y_px}`,
      'fl_layer_apply',
    ];
    transformations.push(reflectionOverlay.join(','));
  }

  return transformations.join('/');
}

function generateParamsHash(params: RenderRequest): string {
  const hashData = JSON.stringify({
    bag: params.bag_public_id,
    backdrop: params.backdrop_public_id,
    placement: params.placement,
    shadow: params.shadow,
    reflection: params.reflection,
  });
  
  // Simple hash function
  let hash = 0;
  for (let i = 0; i < hashData.length; i++) {
    const char = hashData.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(36);
}
