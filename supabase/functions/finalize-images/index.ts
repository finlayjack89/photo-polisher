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
    // Use the correct Gemini 2.5 Flash Image Preview model for image editing
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image-preview" });

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
        // Extract base64 data and detect mime types
        const getImageInfo = (dataUrl: string) => {
          const [header, data] = dataUrl.split(',');
          const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
          return { data, mimeType };
        };
        
        const compositedInfo = getImageInfo(compositedImage.data);
        const maskInfo = getImageInfo(correspondingMask.data);
        
        console.log(`Composited image: ${compositedInfo.mimeType}`);
        console.log(`Mask image: ${maskInfo.mimeType}`);
        
        // Structure the content correctly for Gemini 2.5 Flash Image Preview
        const contents = [
          { text: prompt },
          {
            inlineData: {
              mimeType: compositedInfo.mimeType,
              data: compositedInfo.data
            }
          },
          {
            inlineData: {
              mimeType: maskInfo.mimeType,
              data: maskInfo.data
            }
          }
        ];

        console.log('Calling Gemini 2.5 Flash for image finalization...');
        const result = await model.generateContent(contents);
        
        console.log('Gemini 2.5 Flash finalization completed');
        
        // Parse response for generated image
        let finalizedData = null;
        
        if (result && result.response) {
          console.log('Response received from Gemini 2.5 Flash');
          console.log('Full response structure:', JSON.stringify(result.response, null, 2));
          
          // Check for candidates with image data
          if (result.response.candidates && Array.isArray(result.response.candidates) && result.response.candidates.length > 0) {
            console.log('Candidates array exists with length:', result.response.candidates.length);
            
            for (let i = 0; i < result.response.candidates.length; i++) {
              const candidate = result.response.candidates[i];
              console.log(`Processing candidate ${i}:`, JSON.stringify(candidate, null, 2));
              
              if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {
                console.log(`Candidate ${i} has ${candidate.content.parts.length} parts`);
                
                for (let j = 0; j < candidate.content.parts.length; j++) {
                  const part = candidate.content.parts[j];
                  console.log(`Part ${j}:`, JSON.stringify(part, null, 2));
                  
                  if (part.inlineData && part.inlineData.data) {
                    console.log(`Found generated image data in candidate ${i}, part ${j}`);
                    const mimeType = part.inlineData.mimeType || 'image/jpeg';
                    finalizedData = `data:${mimeType};base64,${part.inlineData.data}`;
                    break;
                  } else if (part.text) {
                    console.log(`Found text response: ${part.text.substring(0, 200)}...`);
                  }
                }
                
                if (finalizedData) break;
              }
              
              // Check for any error indicators
              if (candidate.finishReason) {
                console.log('Finish reason:', candidate.finishReason);
              }
              if (candidate.safetyRatings) {
                console.log('Safety ratings:', JSON.stringify(candidate.safetyRatings));
              }
            }
          } else {
            console.log('No candidates found in response');
          }
        } else {
          console.log('No response received from Gemini');
        }
        
        if (finalizedData) {
          results.push({
            name: compositedImage.name,
            finalizedData: finalizedData
          });
          console.log(`Successfully finalized ${compositedImage.name} using Gemini 2.5 Flash`);
        } else {
          console.error('No image data generated by Gemini 2.5 Flash');
          console.log('Full response structure:', JSON.stringify(result, null, 2));
          throw new Error('Gemini 2.5 Flash did not generate finalized image');
        }
      } catch (error) {
        console.error(`Error finalizing ${compositedImage.name}:`, error);
        throw new Error(`Failed to finalize ${compositedImage.name}: ${error instanceof Error ? error.message : String(error)}`);
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
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});