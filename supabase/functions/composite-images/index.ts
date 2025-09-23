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
        // Prepare the images for Gemini
        const subjectImageData = {
          inlineData: {
            data: subject.data.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/png"
          }
        };

        const backdropImageData = {
          inlineData: {
            data: backdropData.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const result = await model.generateContent([
          prompt, 
          subjectImageData, 
          backdropImageData
        ]);
        
        // Extract the image from the response
        if (result.response.candidates && result.response.candidates[0].content.parts) {
          const part = result.response.candidates[0].content.parts[0];
          if (part.inlineData) {
            const compositedData = `data:image/jpeg;base64,${part.inlineData.data}`;
            results.push({
              name: subject.name,
              compositedData: compositedData
            });
            console.log(`Successfully composited ${subject.name}`);
          } else {
            throw new Error('No image data in response');
          }
        } else {
          throw new Error('Invalid response format from Gemini');
        }
      } catch (error) {
        console.error(`Error compositing ${subject.name}:`, error);
        throw new Error(`Failed to composite ${subject.name}: ${error.message}`);
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
        details: error.message 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});