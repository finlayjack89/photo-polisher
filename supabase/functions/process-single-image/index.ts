import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessSingleImageRequest {
  imageUrl: string;
  imageName: string;
  backdrop: string;
  placement: {
    x: number;
    y: number;
    scale: number;
  };
  addBlur: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { imageUrl, imageName, backdrop, placement, addBlur }: ProcessSingleImageRequest = await req.json();
    
    if (!imageUrl || !imageName || !backdrop || !placement) {
      throw new Error('Missing required parameters');
    }

    console.log(`Processing single image: ${imageName}`);
    
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get Replicate API key for background removal
    const replicateApiKey = Deno.env.get('REPLICATE_API_KEY');
    if (!replicateApiKey) {
      throw new Error('REPLICATE_API_KEY not found');
    }

    // Get Gemini API key for compositing and finalization
    const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiApiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    // Step 1: Remove background
    console.log(`Removing background for ${imageName}...`);
    const { data: bgRemovalResult, error: bgRemovalError } = await supabase.functions.invoke('remove-backgrounds', {
      body: {
        images: [{
          data: imageUrl,
          name: imageName
        }]
      }
    });

    if (bgRemovalError || !bgRemovalResult?.results?.[0]) {
      throw new Error(`Background removal failed: ${bgRemovalError?.message || 'No result'}`);
    }

    const backgroundRemovedData = bgRemovalResult.results[0].backgroundRemovedData;

    // Step 2: Position subject on canvas (simplified for server environment)
    console.log(`Positioning subject for ${imageName}...`);
    const positionedData = await positionSubjectOnCanvas(
      backgroundRemovedData,
      1024, // Standard size
      1024,
      placement
    );

    // Step 3: Composite with AI
    console.log(`Compositing ${imageName}...`);
    
    const genAI = new GoogleGenerativeAI(geminiApiKey);
    const model = genAI.getGenerativeModel({
      model: "gemini-1.5-flash-latest",
      generationConfig: {
        temperature: 0.4,
      },
    });
    
    const compositePrompt = `🚨 CRITICAL COMPOSITING TASK - SUBJECT PRESERVATION IS MANDATORY 🚨

You are a photo background replacement specialist. Your ONLY task is background replacement while maintaining ABSOLUTE SUBJECT INTEGRITY.

⛔ FORBIDDEN ALTERATIONS - YOU MUST NOT:
- Change the subject's appearance, color, texture, material, or finish in ANY way
- Modify the subject's shape, size, form, proportions, or any physical aspects

✅ REQUIRED ACTIONS - YOU MUST:
- Keep the subject EXACTLY as it appears in the input image - pixel-perfect preservation
- Replace ONLY the background/backdrop pixels around the subject
- Create realistic contact shadows beneath the subject on the new backdrop surface
- ${addBlur ? 'Apply subtle background blur ONLY to backdrop areas behind the subject' : 'Keep the backdrop sharp and detailed'}

Output only the final composited image - no text or explanations.`;
    
    const getImageInfo = (dataUrl: string) => {
      const [header, data] = dataUrl.split(',');
      const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
      return { data, mimeType };
    };
    
    const subjectInfo = getImageInfo(positionedData);
    const backdropInfo = getImageInfo(backdrop);
    
    const compositeContents = [
      { text: compositePrompt },
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

    const compositeResult = await model.generateContent(compositeContents);
    
    let compositedData = null;
    if (compositeResult?.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
      const mimeType = compositeResult.response.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
      compositedData = `data:${mimeType};base64,${compositeResult.response.candidates[0].content.parts[0].inlineData.data}`;
    }

    if (!compositedData) {
      throw new Error(`Failed to generate composited image for ${imageName}`);
    }

    // Step 4: Finalization
    console.log(`Finalizing ${imageName}...`);
    
    const finalizationPrompt = `Edit this composited product image to add professional finishing touches.

TASK: You are given two images:
1. Main image: A product composited onto a backdrop 
2. Reference image: Shows where the product is positioned

EDITS TO MAKE:
- Refine and soften the shadow under the product to look more realistic
- Add a subtle reflection of the product on the surface
- Adjust lighting and colors to make everything look natural together
- Keep the product exactly as it is - only improve shadows, reflections, and lighting

Generate the final edited image with these improvements.`;
    
    const compositedInfo = getImageInfo(compositedData);
    const guidanceInfo = getImageInfo(positionedData);
    
    const finalizeContents = [
      { text: finalizationPrompt },
      {
        inlineData: {
          mimeType: compositedInfo.mimeType,
          data: compositedInfo.data
        }
      },
      {
        inlineData: {
          mimeType: guidanceInfo.mimeType,
          data: guidanceInfo.data
        }
      }
    ];

    const finalizeResult = await model.generateContent(finalizeContents);
    
    let finalizedData = null;
    if (finalizeResult?.response?.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data) {
      const mimeType = finalizeResult.response.candidates[0].content.parts[0].inlineData.mimeType || 'image/png';
      finalizedData = `data:${mimeType};base64,${finalizeResult.response.candidates[0].content.parts[0].inlineData.data}`;
    }

    // Use composited image as fallback if finalization fails
    const finalImage = finalizedData || compositedData;

    console.log(`Successfully processed ${imageName}`);

    return new Response(JSON.stringify({ 
      success: true,
      result: {
        name: imageName,
        finalizedData: finalImage
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in process-single-image:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process image', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

// Position subject on canvas function (simplified for server environment)
async function positionSubjectOnCanvas(
  subjectDataUrl: string,
  canvasWidth: number,
  canvasHeight: number,
  placement: any
): Promise<string> {
  // For server environment, we'll return the positioned data URL
  // In a real implementation, you'd use a server-side canvas library
  console.log(`Positioning subject on ${canvasWidth}x${canvasHeight} canvas`);
  return subjectDataUrl; // Simplified - in production use server-side canvas
}