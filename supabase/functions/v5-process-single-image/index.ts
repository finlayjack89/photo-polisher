import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface V5ProcessRequest {
  contextImageUrl: string; // base64 composited context image for AI analysis
  dimensions: {
    width: number;
    height: number;
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { contextImageUrl, dimensions }: V5ProcessRequest = await req.json();
    
    console.log(`=== V5 Processing Started ===`);
    console.log('Parameters:', { 
      hasContextImage: !!contextImageUrl,
      dimensions
    });
    
    if (!contextImageUrl || !dimensions) {
      throw new Error('Missing required parameters: contextImageUrl and dimensions');
    }

    // Generate shadow layer using Gemini
    console.log(`Generating shadow layer from context image...`);
    const shadowLayerData = await generateShadowLayer(contextImageUrl, dimensions);
    console.log(`✓ Shadow layer generation complete`);

    console.log(`=== V5 Processing Complete ===`);

    return new Response(JSON.stringify({ 
      success: true,
      imageData: shadowLayerData
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error(`❌ V5 Processing failed:`, error);
    return new Response(
      JSON.stringify({ 
        success: false,
        error: 'V5 processing failed', 
        details: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Generate shadow/reflection layer using Gemini image generation
async function generateShadowLayer(
  contextImageUrl: string,
  dimensions: { width: number; height: number }
): Promise<string> {
  
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not found');
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: 'gemini-2.5-flash-image-preview',
    generationConfig: {
      temperature: 0.1, // Low temperature for consistent shadow generation
    },
  });

  const prompt = `You are a professional shadow generation AI. Analyze this composited image and generate ONLY realistic shadows and reflections that the product would cast on the surface.

**CRITICAL REQUIREMENTS:**

**1. OUTPUT FORMAT:**
- Generate a PNG image with transparent background
- The image should contain ONLY shadows and reflections - no backdrop, no subject
- Shadows should be semi-transparent (30-60% opacity)
- Output dimensions must exactly match the input image dimensions

**2. SHADOW CHARACTERISTICS:**
- Analyze the existing lighting to determine shadow direction and intensity
- Create soft, realistic shadows that match the lighting environment
- Shadows should be cast from the product's contact points with the surface
- Use ambient occlusion principles for realistic depth

**3. REFLECTION CHARACTERISTICS:**
- Add subtle reflections only if the surface would naturally reflect (glossy/semi-glossy surfaces)
- Reflections should be much fainter than shadows (15-30% opacity)
- Reflections should be geometrically accurate to the product's shape

**4. WHAT NOT TO INCLUDE:**
- Do NOT include the original backdrop in your output
- Do NOT include the subject itself in your output
- Do NOT add any background elements or colors
- Do NOT change or add lighting to the scene itself

Your output must be a transparent PNG containing only the shadow/reflection layer.`;

  console.log(`🤖 Calling Gemini for shadow generation...`);
  
  // Parse the context image
  const [mimeInfo, base64Data] = contextImageUrl.split(',');
  const mimeType = mimeInfo.match(/data:([^;]+)/)?.[1] || 'image/png';

  const shadowContents = [
    {
      role: 'user',
      parts: [
        { text: prompt },
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
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Shadow generation timeout after 45 seconds')), 45000);
  });

  const shadowResult = await Promise.race([shadowPromise, timeoutPromise]);
  const shadowResponse = await (shadowResult as any).response;

  if (!shadowResponse.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
    console.error('No shadow data received from Gemini');
    throw new Error('No shadow data received from Gemini');
  }

  const shadowBase64 = shadowResponse.candidates[0].content.parts[0].inlineData.data;
  const shadowMimeType = shadowResponse.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
  const shadowLayerData = `data:${shadowMimeType};base64,${shadowBase64}`;
  
  console.log(`✅ Shadow layer generated successfully`);
  
  return shadowLayerData;
}