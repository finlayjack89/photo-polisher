import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface V5ProcessRequest {
  contextImageUrl: string; // base64 composited context image for AI analysis
  dimensions: {
    width: number;
    height: number;
  };
}

// HEIC detection and conversion utility
const isHeicFile = (fileName: string): boolean => {
  return fileName.toLowerCase().endsWith('.heic') || fileName.toLowerCase().endsWith('.heif');
};

// Convert data URL to ensure PNG format for quality preservation
const ensurePngFormat = (dataUrl: string, fileName: string): string => {
  if (isHeicFile(fileName) && !dataUrl.startsWith('data:image/png')) {
    // For HEIC files, ensure PNG format is used
    return dataUrl.replace(/^data:image\/[^;]+/, 'data:image/png');
  }
  return dataUrl;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contextImageUrl, dimensions }: V5ProcessRequest = await req.json();
    
    console.log(`=== V5 Processing Started ===`);
    console.log('Parameters:', { 
      hasContextImage: !!contextImageUrl,
      dimensions
    });
    
    if (!contextImageUrl || !dimensions) {
      throw new Error('Missing required parameters: contextImageUrl and dimensions');
    }

    // Get Gemini API key
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-2.5-flash-image-preview",
      generationConfig: {
        temperature: 0.2,
      }
    });

    console.log(`Using Gemini 2.5 Flash Image Preview for shadow layer generation`);

    // Generate shadow layer using the context image
    console.log(`Generating shadow layer from context image...`);
    const shadowLayerData = await generateShadowLayer(
      model, 
      contextImageUrl, 
      dimensions
    );
    console.log(`✓ Shadow layer generation complete`);

    console.log(`=== V5 Processing Complete ===`);

    return new Response(JSON.stringify({ 
      success: true,
      imageData: shadowLayerData
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`❌ V5 Processing failed:`, error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'V5 processing failed', 
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Generate shadow/reflection layer using Gemini 2.5 Flash Image Preview
async function generateShadowLayer(
  model: any,
  contextImageUrl: string,
  dimensions: { width: number; height: number }
): Promise<string> {
  
  const prompt = `
    You are a world-class visual effects artist for a professional product photography studio.
    Your task is to analyze the provided reference image of a product composited onto a studio backdrop and generate a physically realistic effects layer.

    **Analysis of Reference Image:**
    1.  **Infer the Lighting:** Analyze the highlights and shadows on the backdrop to determine the primary light source's direction, softness, and color temperature.
    2.  **Analyze the Surface:** Determine the properties of the surface the product is resting on (e.g., matte, semi-gloss, reflective).

    **Generation Task:**
    Based on your analysis, generate a single image containing ONLY two elements: a shadow and a reflection.

    **CRITICAL INSTRUCTIONS:**
    1.  **Output Format:** You MUST output a single PNG file with a fully transparent background. This is an "effects layer" and must contain no part of the original subject or backdrop.
    2.  **Shadow Generation:**
        * The shadow must be cast away from the inferred primary light source.
        * It should be a soft, diffuse contact shadow that grounds the product realistically. Do not create a long, hard shadow.
        * The shadow's color should be a dark, low-saturation version of the backdrop color, not pure black.
        * The opacity should be around 40-60%, making it present but not overpowering.
    3.  **Reflection Generation:**
        * Generate a subtle, mirror-image reflection of the product directly beneath it.
        * The reflection should be vertically flipped.
        * It must have a gradient mask applied so that it fades out (becomes more transparent) with distance from the subject.
        * The reflection's opacity should be very low, between 5-15%, to simulate a semi-gloss surface.
    4.  **Dimensions:** The output PNG must have the exact dimensions of the reference image: ${dimensions.width}x${dimensions.height}.

    Do not generate the final composited image. Your only output is the transparent PNG effects layer.
  `;

  const imagePart = {
    inlineData: {
      data: contextImageUrl.split(",")[1], // Remove the "data:image/png;base64," prefix
      mimeType: 'image/png' // We are now sending a PNG for max quality
    }
  };

  console.log(`Calling Gemini 2.5 Flash Image Preview for shadow layer generation...`);
  const result = await model.generateContent([prompt, imagePart]);
  
  let shadowLayerData = null;
  if (result?.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
    const mimeType = result.response.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
    shadowLayerData = `data:${mimeType};base64,${result.response.candidates[0].content.parts[0].inlineData.data}`;
  }

  if (!shadowLayerData) {
    throw new Error('Failed to generate shadow layer');
  }

  return shadowLayerData;
}