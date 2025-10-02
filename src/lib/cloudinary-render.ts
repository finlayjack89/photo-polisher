/**
 * Cloudinary render utilities for "Marble Studio Gloss v1" preset
 * Handles server-side compositing with shadows and reflections
 */

import { supabase } from "@/integrations/supabase/client";

export interface RenderParams {
  bag_public_id: string;
  backdrop_public_id: string;
  canvas: {
    w: number;
    h: number;
    format: string;
  };
  placement: {
    mode: string;
    x: number; // Normalized 0-1 position
    y: number; // Normalized 0-1 position
    y_baseline_px: number; // Floor baseline for effects clipping
    rotation_deg: number;
    scale: number;
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

// House preset: "Marble Studio Gloss v1"
export const MARBLE_STUDIO_GLOSS_V1: Partial<RenderParams> = {
  canvas: {
    w: 2048,
    h: 2048,
    format: "png",
  },
  placement: {
    mode: "fit_entire_subject",
    x: 0.5, // Center
    y: 0.7, // 70% down from top
    y_baseline_px: 1660,
    rotation_deg: 0,
    scale: 0.5,
  },
  shadow: {
    contact: {
      opacity: 0.45,
      radius_px: 16,
      offset_y_px: 3,
    },
    ground: {
      opacity: 0.16,
      radius_px: 34,
      elongation_y: 1.0,
    },
  },
  reflection: {
    enabled: true,
    opacity: 0.30,
    fade_pct: 65,
    blur_px: 3,
    offset_y_px: 6,
  },
  backdrop_fx: {
    wall_blur_px: 2,
  },
  safeguards: {
    preserve_subject_pixels: true,
    no_auto_color_subject: true,
    fit_entire_subject: true,
  },
};

/**
 * Call the render-composite Edge Function
 */
export const renderComposite = async (params: RenderParams): Promise<{ url: string; render_time_ms: number; params_hash: string }> => {
  console.log('Calling render-composite with params:', params);
  
  const { data, error } = await supabase.functions.invoke('render-composite', {
    body: params,
  });

  if (error) {
    console.error('Error calling render-composite:', error);
    throw new Error(`Render failed: ${error.message}`);
  }

  console.log('Render complete:', data);
  return data;
};

/**
 * Upload image to Cloudinary via a signed upload
 * Returns the public_id for use in transformations
 */
export const uploadToCloudinary = async (
  imageDataUrl: string,
  type: 'bag' | 'backdrop',
  userId: string
): Promise<{ public_id: string; version: number; width: number; height: number }> => {
  console.log('Uploading to Cloudinary:', { type, userId });
  
  const { data, error } = await supabase.functions.invoke('upload-to-cloudinary', {
    body: {
      image_data_url: imageDataUrl,
      folder: `${userId}/${type}s`,
      type,
    },
  });

  if (error) {
    console.error('Error uploading to Cloudinary:', error);
    throw new Error(`Upload failed: ${error.message}`);
  }

  console.log('Upload complete:', data);
  return data;
};
