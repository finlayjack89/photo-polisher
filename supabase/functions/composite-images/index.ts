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

// Function to reduce image size for API constraints
const reduceImageSize = async (files: Array<{ data: string; name: string; format?: string }>): Promise<Array<{ data: string; name: string; format?: string }>> => {
  const processedFiles = [];

  for (const file of files) {
    try {
      console.log(`Processing image: ${file.name}`);
      
      // Check original size
      const originalSize = Math.round((file.data.length * 3) / 4 / 1024); // Approximate KB
      console.log(`Original size: ${originalSize}KB`);
      
      // If already small enough (under 800KB for Gemini 2.5), use as-is
      if (originalSize <= 800) {
        console.log(`Image ${file.name} is already small enough`);
        processedFiles.push(file);
        continue;
      }
      
      // Extract base64 data
      const [header, base64Data] = file.data.split(',');
      
      // Reduce size by sampling every nth character to achieve target size
      const targetSize = 600; // Target 600KB for Gemini 2.5 Flash
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
  let prompt = `You are a professional photo compositor. Create a realistic composite image by combining the product from the first image with the backdrop from the second image.

**TASK:**
- Composite the product (first image) onto the backdrop (second image)
- The product is already positioned correctly and has a transparent background
- Generate a realistic shadow where the product touches the surface
- Match the lighting between product and backdrop
- Ensure proper perspective and scale`;

  if (addBlur) {
    prompt += `
- Apply subtle depth-of-field blur to the backdrop area directly behind the product
- Keep the product itself sharp and in focus`;
  }

  prompt += `

**OUTPUT:**
Generate a single, high-quality composite image that looks like a professional product photograph. The result should be photorealistic with natural shadows and lighting.`;

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
    // Use Gemini 2.5 Flash Image Preview - supports image generation
    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-image-preview" });

    const prompt = buildCompositingPrompt(addBlur);
    const results = [];

    console.log(`Processing ${positionedSubjects.length} subjects for compositing`);
    console.log(`Using Gemini 2.5 Flash Image Preview model`);
    console.log(`Add blur: ${addBlur}`);

    for (let i = 0; i < positionedSubjects.length; i++) {
      const subject = positionedSubjects[i];
      console.log(`Compositing subject ${i + 1}/${positionedSubjects.length}: ${subject.name}`);

      try {
        // Reduce image sizes for Gemini API
        console.log('Reducing image sizes for Gemini 2.5 Flash...');
        const imagesToProcess = [
          { data: subject.data, name: `subject-${subject.name}` },
          { data: backdropData, name: 'backdrop' }
        ];
        
        const processedImages = await reduceImageSize(imagesToProcess);
        const processedSubjectData = processedImages[0].data;
        const processedBackdropData = processedImages[1].data;
        
        // Prepare the images for Gemini
        const subjectImageData = {
          inlineData: {
            data: processedSubjectData.split(',')[1],
            mimeType: "image/jpeg"
          }
        };

        const backdropImageData = {
          inlineData: {
            data: processedBackdropData.split(',')[1],
            mimeType: "image/jpeg"
          }
        };

        console.log('Calling Gemini 2.5 Flash for image compositing...');
        const result = await model.generateContent([
          prompt, 
          subjectImageData, 
          backdropImageData
        ]);
        
        console.log('Gemini 2.5 Flash API call completed');
        
        // Parse response for generated image
        let compositedData = null;
        
        if (result && result.response) {
          console.log('Response received from Gemini 2.5 Flash');
          
          // Check for candidates with image data
          if (result.response.candidates && Array.isArray(result.response.candidates) && result.response.candidates.length > 0) {
            console.log('Candidates array exists with length:', result.response.candidates.length);
            
            for (let i = 0; i < result.response.candidates.length; i++) {
              const candidate = result.response.candidates[i];
              
              if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {
                console.log(`Candidate ${i} has ${candidate.content.parts.length} parts`);
                
                for (let j = 0; j < candidate.content.parts.length; j++) {
                  const part = candidate.content.parts[j];
                  
                  if (part.inlineData && part.inlineData.data) {
                    console.log(`Found generated image data in candidate ${i}, part ${j}`);
                    compositedData = `data:image/jpeg;base64,${part.inlineData.data}`;
                    break;
                  } else if (part.text) {
                    console.log(`Found text response: ${part.text.substring(0, 100)}...`);
                  }
                }
                
                if (compositedData) break;
              }
            }
          }
          
          // Check for any error indicators
          if (!compositedData && result.response.candidates && result.response.candidates[0]) {
            const candidate = result.response.candidates[0];
            if (candidate.finishReason) {
              console.log('Finish reason:', candidate.finishReason);
            }
            if (candidate.safetyRatings) {
              console.log('Safety ratings:', JSON.stringify(candidate.safetyRatings));
            }
          }
        }
        
        if (compositedData) {
          results.push({
            name: subject.name,
            compositedData: compositedData
          });
          console.log(`Successfully composited ${subject.name} using Gemini 2.5 Flash`);
        } else {
          console.error('No image data generated by Gemini 2.5 Flash');
          console.log('Full response structure:', JSON.stringify(result, null, 2));
          throw new Error('Gemini 2.5 Flash did not generate composite image');
        }
        
      } catch (error) {
        console.error(`Error compositing ${subject.name}:`, error);
        throw new Error(`Failed to composite ${subject.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    console.log(`Successfully composited all ${results.length} subjects using Gemini 2.5 Flash`);

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