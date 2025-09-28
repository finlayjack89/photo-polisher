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
      model: "gemini-2.0-flash-exp",
      generationConfig: {
        temperature: 0.2,
      }
    });

    console.log(`Using Gemini 2.0 Flash Exp for shadow layer generation`);

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

// Generate shadow/reflection layer using Gemini 2.0 Flash Exp
async function generateShadowLayer(
  model: any,
  contextImageUrl: string,
  dimensions: { width: number; height: number }
): Promise<string> {
  
  const prompt = `
    Analyze the provided composited image. Your task is to generate a new, separate image containing ONLY the realistic shadows and reflections that the subject would cast in that scene.

    **CRITICAL INSTRUCTIONS:**
    1.  **You MUST output a PNG file with a fully transparent background.** Do not include the original subject or backdrop from the input image. The output must be a layer that can be placed between the subject and the backdrop.
    2.  The dimensions of your output PNG must be exactly ${dimensions.width}x${dimensions.height} to ensure perfect alignment.
    3.  The shadows and reflections should be physically accurate based on the lighting in the provided context image.
  `;

  const imagePart = {
    inlineData: {
      data: contextImageUrl.split(",")[1], // Remove the "data:image/png;base64," prefix
      mimeType: 'image/png' // We are now sending a PNG for max quality
    }
  };

  console.log(`Calling Gemini 2.0 Flash Exp for shadow layer generation...`);
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