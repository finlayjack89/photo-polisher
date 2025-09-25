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
  return `🚨 CRITICAL COMPOSITING TASK - SUBJECT PRESERVATION IS MANDATORY 🚨

You are a photo background replacement specialist. Your ONLY task is background replacement while maintaining ABSOLUTE SUBJECT INTEGRITY.

⛔ FORBIDDEN ALTERATIONS - YOU MUST NOT:
- Change the subject's appearance, color, texture, material, or finish in ANY way
- Modify the subject's shape, size, form, proportions, or any physical aspects
- Add, remove, or alter any details, patterns, logos, markings, or features on the subject
- Change the subject's lighting, reflections, shine, or surface properties
- Reposition, move, rotate, scale, resize, or transform the subject spatially
- Apply any filters, effects, adjustments, enhancements, or modifications to the subject
- Modify the subject's shadows, highlights, or contrast
- Change the subject's perspective, angle, or orientation
- Make the subject look different in ANY visual aspect

✅ REQUIRED ACTIONS - YOU MUST:
- Keep the subject EXACTLY as it appears in the input image - pixel-perfect preservation
- Replace ONLY the background/backdrop pixels around the subject
- Preserve every single detail of the subject's original appearance and characteristics
- Maintain the subject's exact position, scale, and orientation
- Create realistic contact shadows beneath the subject on the new backdrop surface
- ${addBlur ? 'Apply subtle background blur ONLY to backdrop areas behind the subject (keep subject sharp)' : 'Keep the backdrop sharp and detailed'}
- Ensure natural lighting integration between unchanged subject and new background
- Make the composition look photorealistic while keeping subject identical

🎯 TASK FORMULA: 
UNCHANGED SUBJECT (from image 1) + NEW BACKGROUND (from image 2) = FINAL COMPOSITE

⚠️ ABSOLUTE RULE: The subject must remain visually IDENTICAL to the original. Any alteration = TASK FAILURE.

Output only the final composited image - no text or explanations.`;
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