import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface EnhanceRequest {
  images: Array<{
    name: string;
    data: string; // base64 client-composited image
  }>;
}

// Create professional shadow generation prompt
const buildShadowPrompt = (): string => {
  return `You are a master AI photo compositor specializing in hyper-realistic commercial product photography. Your task is to add a realistic shadow to a backdrop image based on a subject's placement.

**CRITICAL INSTRUCTIONS:**

**1. Analysis:**
- Analyze the client-composited image where the subject is already positioned on the backdrop
- The subject's position, shape, and contact points determine where the shadow should be cast

**2. Shadow Generation:**
- Create a realistic shadow on the backdrop as if it were cast by the subject
- Use soft, 360-degree studio lighting with primary illumination from the camera's position (face-on)
- Generate a dense but compact shadow around the subject's base where it contacts the surface
- The shadow should be realistic but not overpowering, suggesting encompassing professional studio lighting

**3. Subject Preservation:**
- CRITICAL: Keep the subject exactly as it appears in the input - do not alter its position, size, color, or characteristics
- Only add the shadow beneath and around the subject's base
- Maintain all existing backdrop elements and subject placement

**Output Requirements:**
- Return the complete image with subject preserved and realistic shadow added
- Maintain exact dimensions and composition
- Professional studio lighting quality
- Your response MUST ONLY contain the final image data. No text.`;
};

// Create professional reflection and polish prompt  
const buildReflectionPrompt = (): string => {
  return `You are a master AI photo compositor creating the final polish for commercial product photography.

**CRITICAL INSTRUCTIONS:**

**1. Refine Shadow:**
- Analyze the existing shadow and ensure it has soft, realistic edges that match professional studio photography
- The shadow should be subtle but present, creating depth without being distracting

**2. Add Reflection:**
- Create a realistic, low-opacity reflection of the subject's base onto the surface it's resting on
- The reflection should be subtle, geometrically accurate, and match the subject's position
- Reflection opacity should be 15-30% and appear naturally on the surface material

**3. Final Lighting & Color Grade:**
- Apply professional studio lighting adjustments to unify the entire scene
- Use soft, multi-directional studio lighting characteristics
- Perform final color grading for a clean, commercial look with neutral-to-cool white balance
- Ensure shadow, reflection, and backdrop integrate seamlessly as one cohesive image

**4. Subject Preservation:**
- CRITICAL: Preserve the subject completely - do not alter its shape, characteristics, position, or structure
- Only enhance the environment around the subject (lighting, reflections, color grade)
- Maintain professional product photography standards

**Output Requirements:**
- Return the final polished image with all enhancements applied
- Professional commercial photography quality
- Perfect integration of all elements
- Your response MUST ONLY contain the final image data. No text.`;
};

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting AI image enhancement...');
    const { images }: EnhanceRequest = await req.json();
    
    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided for enhancement');
    }

    // Initialize Google Generative AI
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        temperature: 0.4,
        maxOutputTokens: 4096,
      },
    });

    const results = [];

    // Process each image
    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      console.log(`Enhancing image ${i + 1}/${images.length}: ${image.name}`);

      try {
        // Validate base64 image data
        if (!image.data || !image.data.startsWith('data:image/')) {
          console.log(`Skipping invalid image data for ${image.name}`);
          results.push({
            name: image.name,
            enhancedData: image.data // Return original if invalid
          });
          continue;
        }

        // Extract mime type and base64 data
        const [mimeInfo, base64Data] = image.data.split(',');
        const mimeType = mimeInfo.match(/data:([^;]+)/)?.[1] || 'image/png';

        // Step 1: Add realistic shadows
        console.log(`Step 1: Adding shadows for ${image.name}...`);
        const shadowContents = [
          {
            role: 'user',
            parts: [
              { text: buildShadowPrompt() },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ];

        const shadowPromise = model.generateContent({ contents: shadowContents });
        const shadowTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Shadow generation timeout')), 30000);
        });

        const shadowResult = await Promise.race([shadowPromise, shadowTimeoutPromise]);
        const shadowResponse = await (shadowResult as any).response;

        if (!shadowResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          console.log(`Shadow generation failed for ${image.name}, using original`);
          results.push({
            name: image.name,
            enhancedData: image.data
          });
          continue;
        }

        // Extract shadow-enhanced image data
        const shadowBase64 = shadowResponse.candidates[0].content.parts[0].inlineData.data;
        const shadowMimeType = shadowResponse.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
        
        console.log(`Step 2: Adding reflections and final polish for ${image.name}...`);
        
        // Step 2: Add reflections and final polish
        const reflectionContents = [
          {
            role: 'user',
            parts: [
              { text: buildReflectionPrompt() },
              {
                inlineData: {
                  mimeType: shadowMimeType,
                  data: shadowBase64,
                },
              },
            ],
          },
        ];

        const reflectionPromise = model.generateContent({ contents: reflectionContents });
        const reflectionTimeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Reflection generation timeout')), 30000);
        });

        const reflectionResult = await Promise.race([reflectionPromise, reflectionTimeoutPromise]);
        const reflectionResponse = await (reflectionResult as any).response;

        if (!reflectionResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          console.log(`Reflection generation failed for ${image.name}, using shadow version`);
          results.push({
            name: image.name,
            enhancedData: `data:${shadowMimeType};base64,${shadowBase64}`
          });
          continue;
        }

        // Extract final enhanced image data
        const finalBase64 = reflectionResponse.candidates[0].content.parts[0].inlineData.data;
        const finalMimeType = reflectionResponse.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
        const finalDataUrl = `data:${finalMimeType};base64,${finalBase64}`;

        console.log(`Successfully enhanced ${image.name} with shadows and reflections`);
        results.push({
          name: image.name,
          enhancedData: finalDataUrl
        });

      } catch (imageError) {
        console.error(`Error enhancing ${image.name}:`, imageError);
        // Fallback to original image
        results.push({
          name: image.name,
          enhancedData: image.data
        });
      }
    }

    console.log(`Enhancement complete: ${results.length} images processed`);

    return new Response(JSON.stringify({ 
      success: true, 
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in finalize-image-v3:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error occurred'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});