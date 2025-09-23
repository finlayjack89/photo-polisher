import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FinalizeRequest {
  compositedImages: Array<{
    name: string;
    data: string; // base64 composited image
  }>;
  originalMasks: Array<{
    name: string;
    data: string; // base64 mask for shadow guidance
  }>;
}

const buildFinalizationPrompt = (): string => {
  return `You are an expert AI photo editor performing the final touches on a commercial product shot.
    
**Inputs:**
1. A composited image containing a product on a backdrop with a preliminary shadow.
2. A shadow guidance mask. The white area indicates where the final shadow should be.

**CRITICAL INSTRUCTIONS:**

**1. Refine Shadow:**
- Adjust the shadow in the composited image to perfectly match the mask. Keep shadow where the mask is white, remove it where it's not. Ensure the final shadow has soft, realistic edges.

**2. Add Reflection:**
- Create a realistic, low-opacity reflection of the subject's base onto the surface it's resting on. The reflection should be subtle and geometrically accurate.

**3. Final Lighting & Color Grade:**
- Perform final lighting adjustments to unify the scene completely. The subject, shadow, reflection, and backdrop must look like they belong in the same environment.
- The overall lighting style is soft, multi-directional studio lighting.
- Apply a final color grade for a professional, clean, commercial look with a neutral-to-cool white balance.

**Output:**
- A single, high-quality, final edited image with the exact same dimensions as the input image.
- Your response MUST ONLY contain the final image data. No text.`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { compositedImages, originalMasks }: FinalizeRequest = await req.json();
    
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = buildFinalizationPrompt();
    const results = [];

    console.log(`Finalizing ${compositedImages.length} images`);

    for (let i = 0; i < compositedImages.length; i++) {
      const compositedImage = compositedImages[i];
      const correspondingMask = originalMasks.find(mask => mask.name === compositedImage.name);
      
      if (!correspondingMask) {
        throw new Error(`No corresponding mask found for ${compositedImage.name}`);
      }

      console.log(`Finalizing image ${i + 1}/${compositedImages.length}: ${compositedImage.name}`);

      try {
        // Prepare the images for Gemini
        const compositedImageData = {
          inlineData: {
            data: compositedImage.data.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const maskImageData = {
          inlineData: {
            data: correspondingMask.data.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/png"
          }
        };

        const result = await model.generateContent([
          prompt, 
          compositedImageData, 
          maskImageData
        ]);
        
        // Extract the image from the response
        if (result.response.candidates && result.response.candidates[0].content.parts) {
          const part = result.response.candidates[0].content.parts[0];
          if (part.inlineData) {
            const finalizedData = `data:image/jpeg;base64,${part.inlineData.data}`;
            results.push({
              name: compositedImage.name,
              finalizedData: finalizedData
            });
            console.log(`Successfully finalized ${compositedImage.name}`);
          } else {
            throw new Error('No image data in response');
          }
        } else {
          throw new Error('Invalid response format from Gemini');
        }
      } catch (error) {
        console.error(`Error finalizing ${compositedImage.name}:`, error);
        throw new Error(`Failed to finalize ${compositedImage.name}: ${error.message}`);
      }
    }

    console.log(`Successfully finalized all ${results.length} images`);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in finalize-images function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to finalize images', 
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});