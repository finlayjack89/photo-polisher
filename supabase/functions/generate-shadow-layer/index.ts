import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ShadowGenerationRequest {
  backdrop: string; // Pure backdrop image (base64)
  subjectData: string; // Transparent subject PNG (base64)
  placement: {
    x: number;
    y: number;
    scale: number;
  };
  imageName: string;
}

const buildPureShadowPrompt = (): string => {
  return `You are a professional shadow generation AI. You will receive two images:
1. A pure backdrop/background scene
2. A transparent subject image showing what object will be placed on the backdrop

Your task is to generate ONLY realistic shadows and reflections that this subject would cast on the backdrop, based on the subject's shape and the backdrop's lighting.

**CRITICAL REQUIREMENTS:**

**1. OUTPUT FORMAT:**
- Generate a PNG image with transparent background
- The image should contain ONLY shadows and reflections - no backdrop, no subject
- Shadows should be semi-transparent (30-60% opacity)
- Output dimensions must exactly match the backdrop image dimensions

**2. SHADOW CHARACTERISTICS:**
- Analyze the backdrop's existing lighting to determine shadow direction and intensity
- Create soft, realistic shadows that match the lighting environment
- Shadows should be cast from the subject's contact points with the surface
- Use ambient occlusion principles for realistic depth

**3. REFLECTION CHARACTERISTICS:**
- Add subtle reflections only if the backdrop surface would naturally reflect (glossy/semi-glossy surfaces)
- Reflections should be much fainter than shadows (15-30% opacity)
- Reflections should be geometrically accurate to the subject's shape

**4. WHAT NOT TO INCLUDE:**
- Do NOT include the original backdrop in your output
- Do NOT include the subject itself in your output
- Do NOT add any background elements or colors
- Do NOT change or add lighting to the scene itself

**5. QUALITY:**
- Maintain high resolution matching the backdrop
- Use soft, realistic shadow edges (no hard cuts)
- Ensure shadows integrate naturally with existing scene lighting

Your output must be a transparent PNG containing only the shadow/reflection layer that can be composited between the backdrop and subject.`;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('🎯 Shadow Layer Generation Started');
    const { backdrop, subjectData, placement, imageName }: ShadowGenerationRequest = await req.json();
    
    // Validation
    if (!backdrop || !subjectData || !placement || !imageName) {
      throw new Error('Missing required parameters for shadow generation');
    }

    console.log(`📊 Processing ${imageName}:`, {
      backdropSize: backdrop.length,
      subjectSize: subjectData.length,
      placement,
      backdropFormat: backdrop.substring(0, 50),
      subjectFormat: subjectData.substring(0, 50)
    });

    // Initialize Google Generative AI
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not configured');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: 'gemini-2.0-flash-exp',
      generationConfig: {
        temperature: 0.1, // Very low for consistent shadow generation
      },
    });

    // Parse image data
    const backdropInfo = backdrop.includes(',') ? backdrop.split(',') : ['data:image/png;base64', backdrop];
    const subjectInfo = subjectData.includes(',') ? subjectData.split(',') : ['data:image/png;base64', subjectData];
    
    const backdropMimeType = backdropInfo[0].match(/data:([^;]+)/)?.[1] || 'image/png';
    const subjectMimeType = subjectInfo[0].match(/data:([^;]+)/)?.[1] || 'image/png';

    console.log(`🔍 Image formats - Backdrop: ${backdropMimeType}, Subject: ${subjectMimeType}`);

    // Generate shadow layer using Gemini
    console.log('🤖 Calling Gemini for shadow generation...');
    const shadowContents = [
      {
        role: 'user',
        parts: [
          { text: buildPureShadowPrompt() },
          {
            inlineData: {
              mimeType: backdropMimeType,
              data: backdropInfo[1],
            },
          },
          {
            inlineData: {
              mimeType: subjectMimeType,
              data: subjectInfo[1],
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
      console.warn(`❌ Shadow generation failed for ${imageName} - no data returned`);
      throw new Error(`Shadow generation failed for ${imageName}`);
    }

    // Extract shadow layer data
    const shadowBase64 = shadowResponse.candidates[0].content.parts[0].inlineData.data;
    const shadowMimeType = shadowResponse.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
    const shadowDataUrl = `data:${shadowMimeType};base64,${shadowBase64}`;

    console.log(`✅ Successfully generated shadow layer for ${imageName}`);
    console.log(`📏 Shadow layer size: ${shadowDataUrl.length} characters`);

    return new Response(JSON.stringify({ 
      success: true,
      result: {
        name: imageName,
        shadowLayerData: shadowDataUrl,
        placement: placement,
        metadata: {
          shadowFormat: shadowMimeType,
          processingTime: Date.now(),
          method: 'pure_layer_generation'
        }
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('❌ Shadow generation error:', error);
    return new Response(JSON.stringify({ 
      success: false, 
      error: error instanceof Error ? error.message : 'Shadow generation failed',
      timestamp: new Date().toISOString()
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});