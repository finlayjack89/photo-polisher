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

// Enhanced image validation and size checking
const validateAndProcessImage = async (imageData: string, imageName: string, maxSizeKB: number = 4096): Promise<string> => {
  try {
    // Check if image data exists and is valid
    if (!imageData || typeof imageData !== 'string') {
      throw new Error(`Invalid image data for ${imageName}: empty or non-string`);
    }

    // Check if it's a valid data URL
    if (!imageData.startsWith('data:image/')) {
      throw new Error(`Invalid image format for ${imageName}: must be a data URL starting with 'data:image/'`);
    }

    // Extract and validate base64 data
    const [header, base64Data] = imageData.split(',');
    if (!base64Data || base64Data.length === 0) {
      throw new Error(`No base64 data found for ${imageName}`);
    }

    // Validate base64 format
    try {
      atob(base64Data);
    } catch (error) {
      throw new Error(`Invalid base64 encoding for ${imageName}`);
    }

    // Calculate and log size
    const originalSize = Math.round((base64Data.length * 3) / 4 / 1024);
    console.log(`${imageName} validated - Size: ${originalSize}KB, limit: ${maxSizeKB}KB`);
    
    if (originalSize === 0) {
      throw new Error(`Image ${imageName} appears to be empty (0KB)`);
    }

    if (originalSize > 20480) { // 20MB hard limit for Gemini
      throw new Error(`Image ${imageName} (${originalSize}KB) exceeds Gemini's 20MB limit`);
    }
    
    if (originalSize > maxSizeKB) {
      console.log(`Warning: ${imageName} (${originalSize}KB) exceeds recommended limit (${maxSizeKB}KB)`);
    }
    
    return imageData;
    
  } catch (error) {
    console.error(`Image validation failed for ${imageName}:`, error);
    throw error;
  }
};

// Retry logic with exponential backoff
const retryWithBackoff = async <T>(
  operation: () => Promise<T>,
  maxRetries: number = 3,
  baseDelay: number = 1000
): Promise<T> => {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      if (attempt === maxRetries) {
        throw error;
      }
      
      // Don't retry on certain error types
      if (error instanceof Error) {
        const errorMessage = error.message.toLowerCase();
        if (errorMessage.includes('invalid image') || 
            errorMessage.includes('unable to process input image') ||
            errorMessage.includes('safety') ||
            errorMessage.includes('policy')) {
          console.log(`Non-retryable error, failing immediately: ${error.message}`);
          throw error;
        }
      }
      
      const delay = baseDelay * Math.pow(2, attempt - 1);
      console.log(`Attempt ${attempt} failed, retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  throw new Error('Max retries reached');
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
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
      generationConfig: {
        temperature: 0.4,
        responseMimeType: "image/png",
      },
    });

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
        // Validate and process images before sending to Gemini API
        console.log('Validating images for Gemini 2.5 Flash...');
        const processedSubjectData = await validateAndProcessImage(subject.data, subject.name, 4096);
        const processedBackdropData = await validateAndProcessImage(backdropData, 'backdrop', 4096);
        
        // Extract base64 data and detect mime type
        const getImageInfo = (dataUrl: string) => {
          const [header, data] = dataUrl.split(',');
          const mimeType = header.includes('png') ? 'image/png' : 
                          header.includes('jpeg') || header.includes('jpg') ? 'image/jpeg' :
                          header.includes('webp') ? 'image/webp' : 'image/jpeg';
          return { data, mimeType };
        };
        
        const subjectInfo = getImageInfo(processedSubjectData);
        const backdropInfo = getImageInfo(processedBackdropData);
        
        console.log(`Subject image: ${subjectInfo.mimeType}`);
        console.log(`Backdrop image: ${backdropInfo.mimeType}`);
        
        // Composite with retry logic
        const compositedData = await retryWithBackoff(async () => {
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

          console.log(`Calling Gemini 2.5 Flash for image compositing (subject: ${subject.name})...`);
          const result = await model.generateContent(contents);
          
          console.log('Gemini 2.5 Flash API call completed');
          
          // Parse response for generated image
          if (!result || !result.response) {
            throw new Error('No response received from Gemini');
          }

          console.log('Response received from Gemini 2.5 Flash');
          
          // Check for candidates with image data
          if (!result.response.candidates || !Array.isArray(result.response.candidates) || result.response.candidates.length === 0) {
            console.log('No candidates found in response');
            console.log('Full response structure:', JSON.stringify(result.response, null, 2));
            throw new Error('Gemini returned no candidates');
          }

          console.log('Candidates array exists with length:', result.response.candidates.length);
          
          for (let i = 0; i < result.response.candidates.length; i++) {
            const candidate = result.response.candidates[i];
            
            // Check for safety or policy blocks
            if (candidate.finishReason && candidate.finishReason !== 'STOP') {
              console.log(`Candidate ${i} blocked with reason: ${candidate.finishReason}`);
              if (candidate.finishReason === 'SAFETY') {
                throw new Error('Content was blocked by safety filters');
              }
              continue;
            }
            
            if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {
              console.log(`Candidate ${i} has ${candidate.content.parts.length} parts`);
              
              for (let j = 0; j < candidate.content.parts.length; j++) {
                const part = candidate.content.parts[j];
                
                if (part.inlineData && part.inlineData.data) {
                  console.log(`Found generated image data in candidate ${i}, part ${j}`);
                  const mimeType = part.inlineData.mimeType || 'image/jpeg';
                  return `data:${mimeType};base64,${part.inlineData.data}`;
                } else if (part.text) {
                  console.log(`Found text response: ${part.text.substring(0, 200)}...`);
                }
              }
            }
          }
          
          throw new Error('No image data found in Gemini response');
        }, 3, 2000);

        results.push({
          name: subject.name,
          compositedData: compositedData
        });
        console.log(`Successfully composited ${subject.name} using Gemini 2.5 Flash`);
        
      } catch (error) {
        console.error(`Error compositing ${subject.name}:`, error);
        
        // Provide more specific error messages
        let errorMessage = `Failed to composite ${subject.name}`;
        if (error instanceof Error) {
          if (error.message.includes('Unable to process input image')) {
            errorMessage += ': Image format may be unsupported or corrupted. Try converting to JPG/PNG format.';
          } else if (error.message.includes('safety')) {
            errorMessage += ': Content was blocked by safety filters. Try adjusting the image content.';
          } else if (error.message.includes('quota') || error.message.includes('limit')) {
            errorMessage += ': API quota exceeded. Please try again later.';
          } else {
            errorMessage += `: ${error.message}`;
          }
        }
        
        throw new Error(errorMessage);
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