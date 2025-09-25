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

// Function to check image size and pass through if acceptable
const checkImageSize = async (imageData: string, maxSizeKB: number = 4096): Promise<string> => {
  try {
    const originalSize = Math.round((imageData.length * 3) / 4 / 1024);
    console.log(`Image size: ${originalSize}KB, limit: ${maxSizeKB}KB`);
    
    if (originalSize <= maxSizeKB) {
      console.log('Image within acceptable size limits');
      return imageData;
    }
    
    console.log(`Warning: Image (${originalSize}KB) exceeds recommended limit (${maxSizeKB}KB) but proceeding anyway`);
    console.log('Consider using Tinify compression earlier in the pipeline for better results');
    
    // Return original image - let Gemini handle it
    return imageData;
    
  } catch (error) {
    console.error('Error checking image size:', error);
    return imageData;
  }
};

const buildCompositingPrompt = (addBlur: boolean): string => {
  let prompt = `You are a master AI photo compositor specializing in hyper-realistic commercial product photography. Your task is to integrate a product seamlessly onto a new backdrop and add a realistic shadow. Adhere strictly to the following rules.

**Inputs:**
1. A product image with a transparent background (the subject). This image is the same size as the backdrop, and the subject is already placed where it needs to be.
2. A backdrop image.

**CRITICAL INSTRUCTIONS:**

**1. Compositing - POSITIONING IS SACRED:**
- ABSOLUTELY CRITICAL: The subject in the first image is already positioned EXACTLY where the user wants it. DO NOT move, resize, scale, or reposition the subject in ANY way.
- Your ONLY job is to overlay the subject from the first image onto the backdrop image in the EXACT same position and scale.
- The user has spent time carefully positioning this subject - you must preserve their positioning decisions completely.
- Simply composite the subject as-is from the first image onto the backdrop. No repositioning whatsoever.
- The subject's pixels must remain in their exact locations relative to the canvas dimensions.
- CRITICAL: Do not alter the structure, shape, size, position, or physical characteristics of the subject. Only blend it with the background and add shadows.

**2. Shadow Generation:**
- Create a realistic shadow cast by the subject onto the backdrop.
- The lighting is soft, 360-degree studio lighting, with a primary light source coming from the camera's position (face-on with the subject).
- This creates a dense but very small shadow around the perimeter of the subject where it contacts the ground. The shadow should be compact, suggesting encompassing light that prevents large shadows from being cast.
- IMPORTANT: Base the shadow on the subject's CURRENT position in the first image - do not reposition the subject to create the shadow.`;

  if (addBlur) {
    prompt += `

**3. Background Blur:**
- You must apply a subtle, soft, realistic depth-of-field blur to the backdrop image.
- CRITICAL: The blur must ONLY be applied to the area of the backdrop that is directly BEHIND the subject. The subject's position is defined by its placement in the first input image.
- Any part of the backdrop visible to the sides of, above, or below the subject must remain perfectly sharp and in focus. The subject itself must also remain perfectly sharp. This simulates a realistic camera depth of field where the focus plane is on the subject.`;
  }

  prompt += `

**Output:**
- A single, high-quality, edited image with the exact same dimensions as the backdrop image. The image should contain ONLY the composited subject and its shadow on the backdrop. Do not perform other adjustments yet.
- Your response MUST ONLY contain the final image data. No text.`;

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
      console.log(`Subject positioned data size: ${Math.round((subject.data.length * 3) / 4 / 1024)}KB`);

      try {
        // Check image sizes for Gemini API (up to 20MB supported, 4MB recommended)
        console.log('Checking image sizes for Gemini 2.5 Flash...');
        const processedSubjectData = await checkImageSize(subject.data, 4096);
        const processedBackdropData = await checkImageSize(backdropData, 4096);
        
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