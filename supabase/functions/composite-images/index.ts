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

// Function to estimate and limit image size by reducing quality
const limitImageSize = (base64Data: string, maxSizeKB: number = 500): string => {
  // If the image is already small enough, return as is
  const currentSizeKB = Math.round((base64Data.length * 3) / 4 / 1024);
  console.log(`Original image size: ${currentSizeKB}KB`);
  
  if (currentSizeKB <= maxSizeKB) {
    return base64Data;
  }
  
  // For larger images, we'll sample every nth byte to reduce size
  // This is a simple approach that works in Deno environment
  const [header, data] = base64Data.split(',');
  const compressionRatio = maxSizeKB / currentSizeKB;
  const step = Math.ceil(1 / compressionRatio);
  
  let compressedData = '';
  for (let i = 0; i < data.length; i += step) {
    compressedData += data[i];
  }
  
  const result = `${header},${compressedData}`;
  const newSizeKB = Math.round((result.length * 3) / 4 / 1024);
  console.log(`Compressed image size: ${newSizeKB}KB`);
  
  return result;
};

const buildCompositingPrompt = (addBlur: boolean): string => {
  let prompt = `You are a master AI photo compositor specializing in hyper-realistic commercial product photography. Your task is to integrate a product seamlessly onto a new backdrop and add a realistic shadow.

**Inputs:**
1. A product image with a transparent background (the subject). This image is the same size as the backdrop, and the subject is already placed where it needs to be.
2. A backdrop image.

**CRITICAL INSTRUCTIONS:**

**1. Compositing:**
- Composite the subject from the first input onto the backdrop. The subject is already positioned and scaled correctly within its transparent canvas. You must composite it as-is.
- The subject's base should appear to be making solid contact with the 'floor' of the backdrop.

**2. Shadow Generation:**
- Create a realistic shadow cast by the subject onto the backdrop.
- The lighting is soft, 360-degree studio lighting, with a primary light source coming from the camera's position (face-on with the subject).
- This creates a dense but very small shadow around the perimeter of the subject where it contacts the ground.`;

  if (addBlur) {
    prompt += `

**3. Background Blur:**
- You must apply a subtle, soft, realistic depth-of-field blur to the backdrop image.
- CRITICAL: The blur must ONLY be applied to the area of the backdrop that is directly BEHIND the subject. Any part of the backdrop visible to the sides of, above, or below the subject must remain perfectly sharp and in focus. The subject itself must also remain perfectly sharp.`;
  }

  prompt += `

**Output:**
- A single, high-quality, edited image with the exact same dimensions as the backdrop image.
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
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash-exp" });

    const prompt = buildCompositingPrompt(addBlur);
    const results = [];

    console.log(`Processing ${positionedSubjects.length} subjects for compositing`);
    console.log(`Add blur: ${addBlur}`);

    for (let i = 0; i < positionedSubjects.length; i++) {
      const subject = positionedSubjects[i];
      console.log(`Compositing subject ${i + 1}/${positionedSubjects.length}: ${subject.name}`);

      try {
        // Limit image sizes to reduce payload
        console.log('Limiting image sizes for Gemini API...');
        const limitedSubjectData = limitImageSize(subject.data, 400);
        const limitedBackdropData = limitImageSize(backdropData, 400);
        
        // Prepare the images for Gemini
        const subjectImageData = {
          inlineData: {
            data: limitedSubjectData.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const backdropImageData = {
          inlineData: {
            data: limitedBackdropData.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const result = await model.generateContent([
          prompt, 
          subjectImageData, 
          backdropImageData
        ]);
        
        console.log('Full Gemini response structure:', JSON.stringify(result, null, 2));
        
        // Extract the image from the response with more robust parsing
        let compositedData = null;
        
        // Try different response structure patterns
        if (result.response) {
          console.log('Response object exists');
          
          if (result.response.candidates && result.response.candidates.length > 0) {
            console.log('Candidates array exists with length:', result.response.candidates.length);
            const candidate = result.response.candidates[0];
            
            if (candidate.content && candidate.content.parts && candidate.content.parts.length > 0) {
              console.log('Content parts exist with length:', candidate.content.parts.length);
              
              for (const part of candidate.content.parts) {
                console.log('Part structure:', JSON.stringify(part, null, 2));
                
                if (part.inlineData && part.inlineData.data) {
                  console.log('Found inline data in part');
                  compositedData = `data:image/jpeg;base64,${part.inlineData.data}`;
                  break;
                } else if (part.text) {
                  console.log('Found text in part:', part.text.substring(0, 100));
                }
              }
            }
          }
          
          // Try alternative response structure
          if (!compositedData && result.response.text) {
            console.log('Trying response.text format');
            const responseText = await result.response.text();
            console.log('Response text length:', responseText?.length || 0);
          }
        }
        
        if (compositedData) {
          results.push({
            name: subject.name,
            compositedData: compositedData
          });
          console.log(`Successfully composited ${subject.name}`);
        } else {
          console.error('Could not extract image data from response');
          console.error('Full response:', JSON.stringify(result, null, 2));
          throw new Error('No image data found in Gemini response');
        }
      } catch (error) {
        console.error(`Error compositing ${subject.name}:`, error);
        throw new Error(`Failed to composite ${subject.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`Successfully composited all ${results.length} subjects`);

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