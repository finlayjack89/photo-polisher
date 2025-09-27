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

// Create professional finalization prompt
const buildEnhancementPrompt = (): string => {
  return `You are a professional photo editing AI. Your task is to enhance the provided product image with professional finishing touches.

CRITICAL REQUIREMENTS:
1. PRESERVE the subject completely - do not alter, move, or change the product/person in any way
2. PRESERVE the overall composition and placement
3. Only enhance the lighting, shadows, and visual polish

ENHANCEMENTS TO APPLY:
- Add realistic shadows beneath and around the subject that match the lighting
- Enhance lighting to be more natural and professional
- Add subtle reflections if appropriate for the surface
- Improve color balance and contrast for a premium look
- Smooth any harsh edges or artifacts
- Make the overall image look professionally photographed

IMPORTANT: Return ONLY the enhanced image data, no text or explanations.`;
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
      model: 'gemini-1.5-flash',
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

        // Prepare content for Gemini
        const contents = [
          {
            role: 'user',
            parts: [
              { text: buildEnhancementPrompt() },
              {
                inlineData: {
                  mimeType,
                  data: base64Data,
                },
              },
            ],
          },
        ];

        console.log(`Calling Gemini AI for ${image.name}...`);
        
        // Call Gemini with timeout
        const enhancePromise = model.generateContent({ contents });
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('AI enhancement timeout')), 45000);
        });

        const result = await Promise.race([enhancePromise, timeoutPromise]);
        const response = await (result as any).response;

        if (!response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
          console.log(`AI enhancement failed for ${image.name}, using original`);
          results.push({
            name: image.name,
            enhancedData: image.data
          });
          continue;
        }

        // Extract enhanced image data
        const enhancedBase64 = response.candidates[0].content.parts[0].inlineData.data;
        const enhancedMimeType = response.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
        const enhancedDataUrl = `data:${enhancedMimeType};base64,${enhancedBase64}`;

        console.log(`Successfully enhanced ${image.name}`);
        results.push({
          name: image.name,
          enhancedData: enhancedDataUrl
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