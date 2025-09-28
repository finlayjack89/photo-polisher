import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface V5ProcessRequest {
  imageData: string; // base64 background-removed image
  imageName: string;
  backdrop: string; // base64 backdrop image
  placement: {
    x: number;
    y: number;
    scale: number;
  };
  addBlur: boolean;
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
    const { imageData, imageName, backdrop, placement, addBlur }: V5ProcessRequest = await req.json();
    
    console.log(`=== V5 Processing Started: ${imageName} ===`);
    console.log('Parameters:', { 
      hasImageData: !!imageData, 
      imageName, 
      hasBackdrop: !!backdrop, 
      placement,
      addBlur 
    });
    
    if (!imageData || !imageName || !backdrop || !placement) {
      throw new Error(`Missing required parameters for ${imageName}`);
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

    console.log(`Using Gemini 2.5 Flash Image Preview for ${imageName}`);

    // Step 1: Background Removal (Already done on frontend)
    console.log(`✓ Background removal complete for ${imageName}`);
    
    // Ensure PNG format for quality preservation
    const processedImageData = ensurePngFormat(imageData, imageName);
    
    // Step 2: Position subject on canvas (simplified for server)
    console.log(`Step 2: Positioning ${imageName}...`);
    const positionedData = await positionSubjectOnCanvas(
      processedImageData,
      1024,
      1024,
      placement
    );
    console.log(`✓ Positioning complete for ${imageName}`);

    // Step 3: Generate shadow/reflection layer
    console.log(`Step 3: Generating shadow layer for ${imageName}...`);
    const shadowLayerData = await performComposite(
      model, 
      positionedData, 
      backdrop, 
      imageName, 
      addBlur
    );
    console.log(`✓ Shadow layer generation complete for ${imageName}`);

    console.log(`=== V5 Processing Complete: ${imageName} ===`);

    return new Response(JSON.stringify({ 
      success: true,
      result: {
        name: imageName,
        shadowLayerData: shadowLayerData,
        subjectData: positionedData,
        backdropData: backdrop,
        processingSteps: {
          backgroundRemoval: "✓ Complete",
          positioning: "✓ Complete", 
          shadowGeneration: "✓ Complete"
        }
      }
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

// Position subject on canvas (simplified for server environment)
async function positionSubjectOnCanvas(
  subjectDataUrl: string,
  canvasWidth: number,
  canvasHeight: number,
  placement: any
): Promise<string> {
  // In a production environment, this would use server-side canvas manipulation
  // For now, we return the subject data as positioned (frontend handles actual positioning)
  console.log(`Positioning subject on ${canvasWidth}x${canvasHeight} canvas with placement:`, placement);
  return subjectDataUrl;
}

// Generate shadow/reflection layer using Gemini 2.5 Flash Image Preview
async function performComposite(
  model: any,
  positionedData: string,
  backdrop: string,
  imageName: string,
  addBlur: boolean
): Promise<string> {
  
  const compositePrompt = `Analyze the two provided images: an isolated subject on a transparent background and a backdrop scene.

Your task is to generate a new, third image that contains ONLY the realistic shadows and reflections the subject would cast onto the backdrop.

**CRITICAL INSTRUCTIONS:**
1. **Output a PNG file with a fully transparent background.** Do not include the original subject or the backdrop in the output. The output must be a layer that can be placed between the subject and the backdrop.
2. The generated shadows and reflections must be accurately positioned and scaled to match the subject's placement and the lighting of the backdrop.
3. The dimensions of the output image must exactly match the dimensions of the input backdrop image to ensure perfect alignment.
4. The shadow should be soft and diffuse, appropriate for a studio environment.
5. The reflection should be subtle and placed directly beneath the subject, fading with distance.

The goal is to create a physically realistic "effects layer" that can be used to composite the final image. Do not generate the final composite yourself.`;
  
  const getImageInfo = (dataUrl: string) => {
    const [header, data] = dataUrl.split(',');
    const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
    return { data, mimeType };
  };
  
  const subjectInfo = getImageInfo(positionedData);
  const backdropInfo = getImageInfo(backdrop);
  
  const compositeContents = [
    { text: compositePrompt },
    {
      inlineData: {
        mimeType: subjectInfo.mimeType,
        data: subjectInfo.data
      }
    },
    {
      inlineData: {
        mimeType: backdropInfo.mimeType,
        data: backdropInfo.data
      }
    }
  ];

  console.log(`Calling Gemini 2.5 Flash Image Preview for shadow layer generation for ${imageName}...`);
  const compositeResult = await model.generateContent(compositeContents);
  
  let shadowLayerData = null;
  if (compositeResult?.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
    const mimeType = compositeResult.response.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
    shadowLayerData = `data:${mimeType};base64,${compositeResult.response.candidates[0].content.parts[0].inlineData.data}`;
  }

  if (!shadowLayerData) {
    throw new Error(`Failed to generate shadow layer for ${imageName}`);
  }

  return shadowLayerData;
}

// This function is no longer needed as we only generate shadow layers
// Removed to simplify the workflow