import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

    // Generate shadow layer using OpenAI
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

// Generate shadow/reflection layer using OpenAI image generation
async function generateShadowLayer(
  contextImageUrl: string,
  dimensions: { width: number; height: number }
): Promise<string> {
  
  const openaiApiKey = Deno.env.get('OPENAI_API_KEY');
  if (!openaiApiKey) {
    throw new Error('OPENAI_API_KEY not found');
  }

  const prompt = `Create a realistic shadow and reflection layer for a product placed on a surface. The shadow should:
  - Be soft and natural looking
  - Match the lighting conditions of the scene
  - Be transparent PNG with only shadows/reflections visible
  - Have realistic perspective and depth
  - Be subtle and enhance the product placement
  
  Generate a transparent PNG image that contains ONLY shadows and reflections, no objects or background.`;

  console.log(`🤖 Calling OpenAI for shadow generation...`);
  
  const response = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${openaiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'gpt-image-1',
      prompt: prompt,
      n: 1,
      size: `${Math.min(dimensions.width, 1024)}x${Math.min(dimensions.height, 1024)}`,
      output_format: 'png',
      background: 'transparent',
      quality: 'high'
    }),
  });

  const data = await response.json();
  
  if (!response.ok) {
    console.error('OpenAI API error:', data);
    throw new Error(`OpenAI API error: ${data.error?.message || 'Unknown error'}`);
  }

  if (!data.data?.[0]?.b64_json) {
    console.error('No image data received from OpenAI');
    throw new Error('No image data received from OpenAI');
  }

  const shadowLayerData = `data:image/png;base64,${data.data[0].b64_json}`;
  console.log(`✅ Shadow layer generated successfully`);
  
  return shadowLayerData;
}