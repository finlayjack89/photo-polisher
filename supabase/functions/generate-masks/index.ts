import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface MaskRequest {
  images: Array<{
    data: string; // base64 image data
    name: string;
  }>;
  productType: string;
  features: string[];
}

const buildSubjectMaskPrompt = (productType: string, features: string[]): string => {
  let prompt = `You are a precision image segmentation tool. Your sole function is to create a pixel-perfect segmentation mask of a product in an image.

**Task:**
Identify the primary subject (${productType}) in the input image.

**Inclusions for the Mask (must be part of the white area):**
- The entire ${productType}.
- All its permanent parts and attachments.`;

  const featureInstructions: string[] = [];
  
  // Feature-specific logic
  if (features.includes('long_strap')) featureInstructions.push("- The handbag's long strap, in its entirety.");
  if (features.includes('chain_straps')) featureInstructions.push("- All chain straps, including every link.");
  if (features.includes('handles')) featureInstructions.push("- All handles and grip areas.");
  if (features.includes('buckles')) featureInstructions.push("- All buckles, clasps, and metal hardware.");
  if (features.includes('zipper')) featureInstructions.push("- Zipper and zipper pull details.");
  if (features.includes('pockets')) featureInstructions.push("- External pockets and their details.");
  
  if (features.includes('laces')) featureInstructions.push("- All shoelaces, including loose ends.");
  if (features.includes('heel')) featureInstructions.push("- The heel structure completely.");
  if (features.includes('sole_details')) featureInstructions.push("- Sole patterns and textures.");
  
  if (features.includes('strap')) featureInstructions.push("- Watch strap or band completely.");
  if (features.includes('crown')) featureInstructions.push("- Watch crown and any protruding elements.");
  if (features.includes('bezel')) featureInstructions.push("- Watch bezel and markings.");
  
  if (features.includes('chain')) featureInstructions.push("- Jewelry chain, including all links.");
  if (features.includes('pendant')) featureInstructions.push("- Pendant and any hanging elements.");
  if (features.includes('gemstones')) featureInstructions.push("- All gemstones and their settings.");
  
  if (features.includes('cables')) featureInstructions.push("- All cables, wires, and connectors.");
  if (features.includes('buttons')) featureInstructions.push("- All buttons and controls.");
  if (features.includes('screen')) featureInstructions.push("- Screen or display area.");
  if (features.includes('ports')) featureInstructions.push("- All ports and connection points.");
  
  if (features.includes('collar')) featureInstructions.push("- Collar structure and details.");
  if (features.includes('sleeves')) featureInstructions.push("- Sleeves, including cuffs.");
  if (features.includes('belt')) featureInstructions.push("- Belt, ties, or sash elements.");
  
  if (features.includes('legs')) featureInstructions.push("- All legs, supports, or base structure.");
  if (features.includes('cushions')) featureInstructions.push("- Cushions and padding.");
  if (features.includes('fabric')) featureInstructions.push("- Fabric texture and weave details.");
  
  if (features.includes('cap')) featureInstructions.push("- Cap, lid, or closure mechanism.");
  if (features.includes('pump')) featureInstructions.push("- Pump, dispenser, or applicator.");
  if (features.includes('label')) featureInstructions.push("- Product labels and text.");
  
  if (features.includes('packaging')) featureInstructions.push("- Product packaging and wrapping.");
  if (features.includes('seal')) featureInstructions.push("- Seals, caps, and closure mechanisms.");

  if (featureInstructions.length > 0) {
    prompt += `\n${featureInstructions.join('\n')}`;
  }

  prompt += `

**CRITICAL Output Rules:**
1. **Format:** You MUST respond with a single PNG image file ONLY.
2. **Dimensions:** The output mask image MUST have the exact same dimensions as the input image.
3. **Mask Content:**
   - The area covering the product (including all specified features) MUST be 100% pure white (#FFFFFF).
   - EVERYTHING else (the background) MUST be 100% transparent.
4. **Edges:** The edges of the white mask must be sharp, clean, and precisely follow the product's outline.
5. **Exclusions:** Do NOT include any shadows cast by the product on the background.
6. **Response:** Your response MUST NOT contain any text, comments, or explanations. Only the image data.`;

  return prompt;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { images, productType, features }: MaskRequest = await req.json();
    
    const apiKey = Deno.env.get('GEMINI_API_KEY');
    if (!apiKey) {
      throw new Error('GEMINI_API_KEY not found');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ 
      model: "gemini-2.5-flash-image-preview",
      generationConfig: {
        temperature: 0.2,
        responseMimeType: "image/png",
      }
    });

    const prompt = buildSubjectMaskPrompt(productType, features);
    const results = [];

    console.log(`Processing ${images.length} images for mask generation`);
    console.log(`Product type: ${productType}`);
    console.log(`Features: ${features.join(', ')}`);

    for (let i = 0; i < images.length; i++) {
      const image = images[i];
      console.log(`Processing image ${i + 1}/${images.length}: ${image.name}`);

      try {
        // Prepare the image data for Gemini
        const imageData = {
          inlineData: {
            data: image.data.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const result = await model.generateContent([prompt, imageData]);
        
        // Extract the image from the response
        if (result.response.candidates && result.response.candidates[0].content.parts) {
          const part = result.response.candidates[0].content.parts[0];
          if (part.inlineData) {
            const maskData = `data:image/png;base64,${part.inlineData.data}`;
            results.push({
              name: image.name,
              originalData: image.data,
              maskData: maskData
            });
            console.log(`Successfully generated mask for ${image.name}`);
          } else {
            throw new Error('No image data in response');
          }
        } else {
          throw new Error('Invalid response format from Gemini');
        }
      } catch (error) {
        console.error(`Error processing ${image.name}:`, error);
        throw new Error(`Failed to generate mask for ${image.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`Successfully processed all ${results.length} images`);

    return new Response(JSON.stringify({ results }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-masks function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to generate masks', 
        details: error instanceof Error ? error.message : String(error) 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});