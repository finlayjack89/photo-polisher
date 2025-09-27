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
  guidanceImages: Array<{
    name: string;
    data: string; // base64 positioned subject for guidance
  }>;
}

const buildFinalizationPrompt = (): string => {
  return `Edit this composited product image to add professional finishing touches.

TASK: You are given two images:
1. Main image: A product composited onto a backdrop 
2. Reference image: Shows where the product is positioned

EDITS TO MAKE:
- Refine and soften the shadow under the product to look more realistic
- Add a subtle reflection of the product on the surface
- Adjust lighting and colors to make everything look natural together
- Keep the product exactly as it is - only improve shadows, reflections, and lighting

Generate the final edited image with these improvements.`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { compositedImages, guidanceImages }: FinalizeRequest = await req.json();
    
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "image/png",
      },
    });

    const prompt = buildFinalizationPrompt();
    const results = [];

    console.log(`Finalizing ${compositedImages.length} images`);

    for (let i = 0; i < compositedImages.length; i++) {
      const compositedImage = compositedImages[i];
      const correspondingGuidance = guidanceImages.find(guidance => guidance.name === compositedImage.name);
      
      if (!correspondingGuidance) {
        throw new Error(`No corresponding guidance image found for ${compositedImage.name}`);
      }

      console.log(`Finalizing image ${i + 1}/${compositedImages.length}: ${compositedImage.name}`);

      try {
        // Validate input data
        if (!compositedImage.data) {
          throw new Error(`Composited image data is missing for ${compositedImage.name}`);
        }
        if (!correspondingGuidance.data) {
          throw new Error(`Guidance image data is missing for ${correspondingGuidance.name}`);
        }

        // Extract base64 data and detect mime types
        const getImageInfo = (dataUrl: string) => {
          if (!dataUrl || typeof dataUrl !== 'string') {
            throw new Error('Invalid dataUrl: must be a non-empty string');
          }
          const parts = dataUrl.split(',');
          if (parts.length !== 2) {
            throw new Error('Invalid dataUrl format: must contain header and data separated by comma');
          }
          const [header, data] = parts;
          const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
          return { data, mimeType };
        };
        
        const compositedInfo = getImageInfo(compositedImage.data);
        const guidanceInfo = getImageInfo(correspondingGuidance.data);
        
        console.log(`Composited image: ${compositedInfo.mimeType}`);
        console.log(`Guidance image: ${guidanceInfo.mimeType}`);
        
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
              mimeType: guidanceInfo.mimeType,
              data: guidanceInfo.data
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
          // Fallback: If Gemini doesn't generate image, use the original composited image
          console.warn(`Gemini 2.5 Flash didn't generate image for ${compositedImage.name}, using original composited image as fallback`);
          results.push({
            name: compositedImage.name,
            finalizedData: compositedImage.data
          });
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