import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { GoogleGenerativeAI } from 'https://esm.sh/@google/generative-ai@0.21.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🎯 Shadow Layer Generation Started (Modern Workflow)');
    
    // This function now expects a single context image and the original dimensions.
    const { contextImageUrl, dimensions } = await req.json();

    if (!contextImageUrl || !dimensions) {
      throw new Error('Missing required parameters: contextImageUrl and dimensions');
    }

    console.log(`📊 Processing context image with dimensions: ${dimensions.width}x${dimensions.height}`);

    // Initialize the AI client with your API key from environment variables
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);

    // Use the user-specified "Nano Banana" model
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-image-preview",
      generationConfig: {
        temperature: 0.1,
      }
    });

    // This is the perfected prompt for generating studio-quality effects
    const prompt = `
You are a world-class visual effects artist for a professional product photography studio.
Your task is to analyze the provided reference image of a product composited onto a studio backdrop and generate a physically realistic effects layer.

**Analysis of Reference Image:**
1. **Infer the Lighting:** Analyze the highlights and shadows on the backdrop to determine the primary light source's direction, softness, and color temperature.
2. **Analyze the Surface:** Determine the properties of the surface the product is resting on (e.g., matte, semi-gloss, reflective).

**Generation Task:**
Based on your analysis, generate a single image containing ONLY two elements: a shadow and a reflection.

**CRITICAL INSTRUCTIONS:**
1. **Output Format:** You MUST output a single PNG file with a fully transparent background. This is an "effects layer" and must contain no part of the original subject or backdrop.
2. **Shadow Generation:**
   * The shadow must be cast away from the inferred primary light source.
   * It should be a soft, diffuse contact shadow that grounds the product realistically. Do not create a long, hard shadow.
   * The shadow's color should be a dark, low-saturation version of the backdrop color, not pure black.
   * The opacity should be around 40-60%, making it present but not overpowering.
3. **Reflection Generation:**
   * Generate a subtle, mirror-image reflection of the product directly beneath it.
   * The reflection should be vertically flipped.
   * It must have a gradient mask applied so that it fades out (becomes more transparent) with distance from the subject.
   * The reflection's opacity should be very low, between 5-15%, to simulate a semi-gloss surface.
4. **Dimensions:** The output PNG must have the exact dimensions of the reference image: ${dimensions.width}x${dimensions.height}.

Do not generate the final composited image. Your only output is the transparent PNG effects layer.
    `;

    console.log('🤖 Calling Gemini 2.5 Flash Image Preview for effects generation...');

    const imagePart = {
      inlineData: {
        data: contextImageUrl.split(",")[1], // Remove the base64 prefix
        mimeType: 'image/png'
      }
    };

    const result = await model.generateContent([prompt, imagePart]);
    const response = result.response;
    
    console.log('🔍 Gemini response received, parsing result...');
    
    const firstCandidate = response.candidates?.[0];

    if (!firstCandidate || !firstCandidate.content.parts[0]?.inlineData) {
      console.error('❌ AI model did not return valid image data');
      console.log('Response structure:', JSON.stringify(response, null, 2));
      throw new Error("AI model did not return valid image data.");
    }
    
    const imageData = firstCandidate.content.parts[0].inlineData;
    const shadowLayerDataUrl = `data:${imageData.mimeType};base64,${imageData.data}`;

    console.log('✅ Successfully generated effects layer');
    console.log(`📏 Effects layer size: ${shadowLayerDataUrl.length} characters`);

    return new Response(JSON.stringify({ 
      success: true,
      imageData: shadowLayerDataUrl,
      metadata: {
        dimensions,
        method: 'context_image_analysis',
        model: 'gemini-2.5-flash-image-preview'
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Error in generate-shadow-layer function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : 'Shadow generation failed'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
