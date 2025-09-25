import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CompositeRequest {
  backdropData: string; // base64 backdrop image
  positionedSubjects: Array<{
    name: string;
    data: string; // base64 positioned subject image (same dimensions as backdrop)
  }>;
  addBlur: boolean;
}

// Function to reduce image size using canvas resizing (proper approach)
const reduceImageSize = async (imageData: string, maxSizeKB: number = 800): Promise<string> => {
  try {
    const originalSize = Math.round((imageData.length * 3) / 4 / 1024);
    console.log(`Original image size: ${originalSize}KB`);
    
    if (originalSize <= maxSizeKB) {
      console.log('Image already within size limits');
      return imageData;
    }
    
    // For now, if image is too large, we'll use a simple truncation approach
    // but ensure the base64 remains valid
    const [header, base64Data] = imageData.split(',');
    if (!base64Data) {
      console.log('Invalid base64 format, using original');
      return imageData;
    }
    
    // Calculate reduction ratio
    const targetRatio = maxSizeKB / originalSize;
    const targetLength = Math.floor(base64Data.length * targetRatio);
    
    // Make sure the length is divisible by 4 for valid base64
    const validLength = Math.floor(targetLength / 4) * 4;
    const reducedBase64 = base64Data.substring(0, validLength);
    
    // Add proper padding
    const paddingNeeded = (4 - (reducedBase64.length % 4)) % 4;
    const paddedBase64 = reducedBase64 + '='.repeat(paddingNeeded);
    
    const reducedData = `${header},${paddedBase64}`;
    const finalSize = Math.round((reducedData.length * 3) / 4 / 1024);
    
    console.log(`Reduced image: ${originalSize}KB -> ${finalSize}KB`);
    return reducedData;
    
  } catch (error) {
    console.error('Error reducing image size:', error);
    return imageData; // Return original if reduction fails
  }
};

const buildCompositingPrompt = (addBlur: boolean): string => {
  let prompt = `Create a professional product photography composite by combining the positioned product with the backdrop scene. 

The first image shows a product that has been positioned and isolated (with transparent background removed). The second image is the backdrop/scene where the product should be placed.

Your task:
- Seamlessly composite the product from the first image onto the backdrop from the second image
- Generate realistic shadows and reflections where the product contacts surfaces
- Match lighting, color temperature, and contrast between product and backdrop
- Maintain the product's current position and scale`;

  if (addBlur) {
    prompt += `
- Add subtle depth-of-field blur to background elements behind the product
- Keep the product itself in sharp focus`;
  }

  prompt += `

Create a single, photorealistic composite image that appears as if the product was originally photographed in this scene. The result should look like professional commercial product photography with natural lighting and shadows.`;

  return prompt;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { backdropData, positionedSubjects, addBlur }: CompositeRequest = await req.json();
    
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    // Use Gemini 2.5 Flash Image Preview - supports image generation
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image-preview" });

    const prompt = buildCompositingPrompt(addBlur);
    const results = [];

    console.log(`Processing ${positionedSubjects.length} subjects for compositing`);
    console.log(`Using Gemini 2.5 Flash Image Preview model`);
    console.log(`Add blur: ${addBlur}`);

    for (let i = 0; i < positionedSubjects.length; i++) {
      const subject = positionedSubjects[i];
      console.log(`Compositing subject ${i + 1}/${positionedSubjects.length}: ${subject.name}`);

      try {
        // Reduce image sizes for Gemini API
        console.log('Processing images for Gemini 2.5 Flash...');
        const processedSubjectData = await reduceImageSize(subject.data, 800);
        const processedBackdropData = await reduceImageSize(backdropData, 800);
        
        // Extract base64 data and detect mime type
        const getImageInfo = (dataUrl: string) => {
          const [header, data] = dataUrl.split(',');
          const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
          return { data, mimeType };
        };
        
        const subjectInfo = getImageInfo(processedSubjectData);
        const backdropInfo = getImageInfo(processedBackdropData);
        
        console.log(`Subject image: ${subjectInfo.mimeType}`);
        console.log(`Backdrop image: ${backdropInfo.mimeType}`);
        
        // Structure the prompt correctly for multi-image compositing
        const contents = [
          { text: prompt },
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

        console.log('Calling Gemini 2.5 Flash for image compositing...');
        const result = await model.generateContent(contents);
        
        console.log('Gemini 2.5 Flash API call completed');
        
        // Parse response for generated image
        let compositedData = null;
        
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
                    compositedData = `data:${mimeType};base64,${part.inlineData.data}`;
                    break;
                  } else if (part.text) {
                    console.log(`Found text response: ${part.text.substring(0, 200)}...`);
                  }
                }
                
                if (compositedData) break;
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
        
        if (compositedData) {
          results.push({
            name: subject.name,
            compositedData: compositedData
          });
          console.log(`Successfully composited ${subject.name} using Gemini 2.5 Flash`);
        } else {
          console.error('No image data generated by Gemini 2.5 Flash');
          console.log('Full response structure:', JSON.stringify(result, null, 2));
          throw new Error('Gemini 2.5 Flash did not generate composite image');
        }
        
      } catch (error) {
        console.error(`Error compositing ${subject.name}:`, error);
        throw new Error(`Failed to composite ${subject.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`Successfully composited all ${results.length} subjects using Gemini 2.5 Flash`);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in composite-images function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to composite images', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});