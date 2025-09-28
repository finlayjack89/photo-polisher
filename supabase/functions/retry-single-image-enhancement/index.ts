import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.17.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface RetryRequest {
  compositedImageData: string; // base64 image
  temperature: number;         // 0.01-0.99
  imageName: string;
}

const buildEnhancementPrompt = () => {
  return `You are a professional commercial photographer and photo retoucher specializing in e-commerce product photography. Your task is to enhance this product image to achieve a premium, commercial-ready look.

Apply these enhancements while preserving the subject and composition exactly:

1. **Professional Lighting Enhancement:**
   - Add subtle, realistic shadows that ground the product naturally
   - Create soft, diffused reflections that suggest high-end studio lighting
   - Enhance existing lighting to appear more premium and professional

2. **Color & Quality Enhancement:**
   - Perform professional color grading for commercial appeal
   - Enhance contrast and saturation subtly for visual impact
   - Ensure colors are vibrant but realistic for e-commerce standards

3. **Final Polish:**
   - Add subtle depth and dimension through lighting effects
   - Create a cohesive, premium aesthetic throughout the image
   - Maintain natural product proportions and details

4. **CRITICAL Quality Preservation:**
   - Output must be IDENTICAL quality to input - NO compression or quality loss
   - Maintain exact pixel dimensions and resolution  
   - Preserve all fine details, textures, and sharpness
   - Use lossless processing - output at maximum quality settings
   - Do NOT apply any compression algorithms or quality reduction

CRITICAL: Do not alter the product's position, size, or core appearance. Focus only on lighting, shadows, reflections, and color enhancement while maintaining perfect quality.`;
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { compositedImageData, temperature = 0.7, imageName }: RetryRequest = await req.json();

    console.log(`Starting retry enhancement for ${imageName} with temperature ${temperature}`);

    if (!compositedImageData) {
      throw new Error('Missing composited image data');
    }

    // Initialize Gemini API
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-image-preview",
      generationConfig: {
        temperature: Math.max(0.1, temperature) // Ensure minimum quality preservation
      }
    });

    console.log(`Processing enhancement with temperature: ${temperature}`);

    // Create the image part for Gemini
    const imagePart = {
      inlineData: {
        data: compositedImageData.replace(/^data:image\/[a-z]+;base64,/, ''),
        mimeType: "image/png"
      }
    };

    // Generate enhanced image with timeout
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Enhancement timeout')), 45000); // 45 second timeout
    });

    const enhancementPromise = model.generateContent([
      buildEnhancementPrompt(),
      imagePart
    ]);

    const result = await Promise.race([enhancementPromise, timeoutPromise]);
    const response = await (result as any).response;
    
    if (!response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
      console.warn('No enhanced image data received, returning original');
      return new Response(JSON.stringify({
        success: true,
        enhancedImageData: compositedImageData,
        fallback: true
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const enhancedImageData = response.candidates[0].content.parts[0].inlineData.data;
    console.log(`Successfully enhanced ${imageName} with temperature ${temperature}`);

    return new Response(JSON.stringify({
      success: true,
      enhancedImageData: `data:image/png;base64,${enhancedImageData}`,
      temperature: temperature,
      imageName: imageName
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in retry enhancement:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});