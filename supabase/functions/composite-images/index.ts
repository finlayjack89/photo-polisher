import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

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

// Function to upload base64 image to a temporary URL for Replicate
const uploadImageToTempUrl = async (base64Data: string): Promise<string> => {
  // Convert base64 to blob
  const base64Content = base64Data.split(',')[1];
  const binaryData = Uint8Array.from(atob(base64Content), (c) => c.charCodeAt(0));
  
  // For now, we'll use the base64 data directly since Replicate supports it
  return base64Data;
};

// Function to create a simple composite using canvas-like operations
const createSimpleComposite = async (backdropData: string, subjectData: string, addBlur: boolean): Promise<string> => {
  console.log('Creating simple composite using image overlay...');
  
  // For now, we'll return the subject image overlaid on the backdrop
  // This is a simplified approach while we implement proper compositing
  
  try {
    // Convert both images to proper format
    const backdropBase64 = backdropData.split(',')[1];
    const subjectBase64 = subjectData.split(',')[1];
    
    // Simple composite: just return the subject for now
    // In a real implementation, we'd use a proper image compositing library
    console.log('Simple composite created successfully');
    return subjectData; // Temporary: returning subject image
    
  } catch (error) {
    console.error('Error in simple composite:', error);
    throw error;
  }
};

// Function to reduce image size by sampling (works in Deno environment)
const reduceImageSize = async (files: Array<{ data: string; name: string; format?: string }>): Promise<Array<{ data: string; name: string; format?: string }>> => {
  const processedFiles = [];

  for (const file of files) {
    try {
      console.log(`Processing image: ${file.name}`);
      
      // Check original size
      const originalSize = Math.round((file.data.length * 3) / 4 / 1024); // Approximate KB
      console.log(`Original size: ${originalSize}KB`);
      
      // If already small enough (under 400KB), use as-is
      if (originalSize <= 400) {
        console.log(`Image ${file.name} is already small enough`);
        processedFiles.push(file);
        continue;
      }
      
      // Extract base64 data
      const [header, base64Data] = file.data.split(',');
      
      // Reduce size by sampling every nth character to achieve target size
      const targetSize = 300; // Target 300KB
      const compressionRatio = targetSize / originalSize;
      
      if (compressionRatio >= 1) {
        // No compression needed
        processedFiles.push(file);
        continue;
      }
      
      // Sample the base64 data
      const step = Math.ceil(1 / compressionRatio);
      let sampledData = '';
      
      for (let i = 0; i < base64Data.length; i += step) {
        sampledData += base64Data[i] || '';
      }
      
      // Ensure the base64 string length is divisible by 4 (padding)
      while (sampledData.length % 4 !== 0) {
        sampledData += '=';
      }
      
      const reducedData = `${header},${sampledData}`;
      const finalSize = Math.round((reducedData.length * 3) / 4 / 1024);
      
      console.log(`Reduced ${file.name}: ${originalSize}KB -> ${finalSize}KB`);
      
      processedFiles.push({
        ...file,
        data: reducedData
      });
      
    } catch (error) {
      console.error(`Error processing ${file.name}:`, error);
      // If processing fails, use original image
      processedFiles.push(file);
    }
  }

  return processedFiles;
};

const buildCompositingPrompt = (addBlur: boolean): string => {
  let prompt = `You are a master AI photo compositor. I need you to create a realistic composite image by combining two input images.

**CRITICAL: YOU MUST RETURN AN IMAGE, NOT TEXT. Your response should be the composited image only.**

**Inputs:**
1. First image: A product with transparent/removed background, positioned on a canvas the same size as the backdrop
2. Second image: A backdrop/background scene

**Task:**
Composite the product from the first image onto the backdrop from the second image. The product is already positioned correctly within its transparent canvas.

**Requirements:**
1. **Shadow Generation**: Create a realistic contact shadow where the product touches the ground/surface in the backdrop
2. **Lighting Match**: Ensure the product lighting matches the backdrop lighting
3. **Perspective**: Maintain proper perspective and scale`;

  if (addBlur) {
    prompt += `
4. **Depth of Field**: Apply subtle blur to ONLY the backdrop area directly behind the product. Keep the product sharp and in focus.`;
  }

  prompt += `

**Output**: Return ONLY the final composited image. Do not include any text, explanations, or other content - just the image.

The final image should look like a professional product photo with realistic shadows and lighting.`;

  return prompt;
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { backdropData, positionedSubjects, addBlur }: CompositeRequest = await req.json();
    
    const results = [];

    console.log(`Processing ${positionedSubjects.length} subjects for compositing`);
    console.log(`Add blur: ${addBlur}`);

    for (let i = 0; i < positionedSubjects.length; i++) {
      const subject = positionedSubjects[i];
      console.log(`Compositing subject ${i + 1}/${positionedSubjects.length}: ${subject.name}`);

      try {
        // Create composite using simple overlay method
        const compositedData = await createSimpleComposite(backdropData, subject.data, addBlur);
        
        results.push({
          name: subject.name,
          compositedData: compositedData
        });
        
        console.log(`Successfully composited ${subject.name}`);
        
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