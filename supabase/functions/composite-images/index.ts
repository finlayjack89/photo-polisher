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
        // Reduce image sizes for Gemini API
        console.log('Reducing image sizes for Gemini API...');
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
            data: processedSubjectData.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const backdropImageData = {
          inlineData: {
            data: processedBackdropData.split(',')[1], // Remove data:image/...;base64, prefix
            mimeType: "image/jpeg"
          }
        };

        const result = await model.generateContent([
          prompt, 
          subjectImageData, 
          backdropImageData
        ]);
        
        console.log('Gemini API call completed');
        console.log('Full Gemini response structure:', JSON.stringify(result, null, 2));
        
        // Enhanced response parsing with more debugging
        let compositedData = null;
        
        if (result && result.response) {
          console.log('Response object exists');
          
          // Check for candidates array
          if (result.response.candidates && Array.isArray(result.response.candidates) && result.response.candidates.length > 0) {
            console.log('Candidates array exists with length:', result.response.candidates.length);
            
            for (let i = 0; i < result.response.candidates.length; i++) {
              const candidate = result.response.candidates[i];
              console.log(`Checking candidate ${i}:`, JSON.stringify(candidate, null, 2));
              
              if (candidate.content && candidate.content.parts && Array.isArray(candidate.content.parts)) {
                console.log(`Candidate ${i} has ${candidate.content.parts.length} parts`);
                
                for (let j = 0; j < candidate.content.parts.length; j++) {
                  const part = candidate.content.parts[j];
                  console.log(`Part ${j} structure:`, JSON.stringify(part, null, 2));
                  
                  if (part.inlineData && part.inlineData.data) {
                    console.log(`Found inline data in candidate ${i}, part ${j}`);
                    compositedData = `data:image/jpeg;base64,${part.inlineData.data}`;
                    break;
                  } else if (part.text) {
                    console.log(`Found text in candidate ${i}, part ${j}:`, part.text.substring(0, 200));
                  }
                }
                
                if (compositedData) break;
              }
            }
          } else {
            console.log('No valid candidates array found');
            console.log('Response candidates:', result.response.candidates);
          }
          
          // Try alternative response structure
          if (!compositedData && result.response.text) {
            console.log('Trying response.text format');
            try {
              const responseText = await result.response.text();
              console.log('Response text length:', responseText?.length || 0);
              if (responseText && responseText.length > 0) {
                console.log('Response text preview:', responseText.substring(0, 200));
              }
            } catch (textError) {
              console.error('Error getting response text:', textError);
            }
          }
          
        } else {
          console.error('No response object found in result');
          console.log('Full result structure:', JSON.stringify(result, null, 2));
        }
        
        if (compositedData) {
          results.push({
            name: subject.name,
            compositedData: compositedData
          });
          console.log(`Successfully composited ${subject.name}`);
        } else {
          console.error('Could not extract image data from Gemini response');
          console.error('This might indicate:');
          console.error('1. Images are still too large for Gemini');
          console.error('2. Gemini API is having issues');
          console.error('3. The prompt might need adjustment');
          console.error('4. Response format has changed');
          
          // Try to provide more specific error information
          if (result && result.response && result.response.candidates) {
            const candidate = result.response.candidates[0];
            if (candidate && candidate.finishReason) {
              console.error('Finish reason:', candidate.finishReason);
            }
            if (candidate && candidate.safetyRatings) {
              console.error('Safety ratings:', JSON.stringify(candidate.safetyRatings));
            }
          }
          
          throw new Error('No image data found in Gemini response - see logs for details');
        }
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