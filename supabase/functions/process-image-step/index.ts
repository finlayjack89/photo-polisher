import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ProcessImageStepRequest {
  job_id: string;
  image_name: string;
  step: 'composite' | 'finalize';
  image_data?: string; // For composite step
  composited_data?: string; // For finalize step
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id, image_name, step, image_data, composited_data }: ProcessImageStepRequest = await req.json();
    
    if (!job_id || !image_name || !step) {
      throw new Error('Missing required parameters');
    }

    console.log(`Processing step '${step}' for image: ${image_name} in job ${job_id}`);
    
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get job data
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    const { backdrop, placement, addBlur } = job.metadata;
    const backgroundRemovedImages = job.metadata.backgroundRemovedImages || [];
    
    // Find current image index
    const currentImageIndex = backgroundRemovedImages.findIndex((img: any) => img.name === image_name);
    if (currentImageIndex === -1) {
      throw new Error(`Image ${image_name} not found in job`);
    }

    let result = null;
    let nextStep = null;

    if (step === 'composite') {
      // Perform composite step
      console.log(`Compositing ${image_name}...`);
      result = await performComposite(image_data!, backdrop, placement, addBlur);
      
      // Next step is finalize for the same image
      nextStep = {
        job_id,
        image_name,
        step: 'finalize' as const,
        composited_data: result.compositedData
      };

    } else if (step === 'finalize') {
      // Perform finalize step
      console.log(`Finalizing ${image_name}...`);
      result = await performFinalize(composited_data!, image_data || backgroundRemovedImages[currentImageIndex].backgroundRemovedData);
      
      // Save this image's final result to job
      await saveImageResult(supabase, job_id, image_name, result.finalizedData);
      
      // Update processed count
      const processedCount = (job.metadata.processedCount || 0) + 1;
      const totalCount = backgroundRemovedImages.length;
      
      await supabase
        .from('processing_jobs')
        .update({ 
          metadata: {
            ...job.metadata,
            processedCount,
            currentStatus: `Processing ${processedCount}/${totalCount} images...`
          }
        })
        .eq('id', job_id);

      // Determine next step
      const nextImageIndex = currentImageIndex + 1;
      if (nextImageIndex < backgroundRemovedImages.length) {
        // Process next image - start with composite
        const nextImage = backgroundRemovedImages[nextImageIndex];
        nextStep = {
          job_id,
          image_name: nextImage.name,
          step: 'composite' as const,
          image_data: nextImage.backgroundRemovedData
        };
      } else {
        // All images processed - complete the job
        await supabase
          .from('processing_jobs')
          .update({ 
            status: 'completed',
            completed_at: new Date().toISOString(),
            metadata: {
              ...job.metadata,
              processedCount,
              currentStatus: 'Complete'
            }
          })
          .eq('id', job_id);
        
        console.log(`Job ${job_id} completed successfully`);
        return new Response(JSON.stringify({ 
          success: true,
          completed: true,
          message: `All images processed for job ${job_id}`
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // If there's a next step, invoke it
    if (nextStep) {
      console.log(`Triggering next step: ${nextStep.step} for ${nextStep.image_name}`);
      
      // Use setTimeout to continue processing asynchronously
      setTimeout(() => {
        supabase.functions.invoke('process-image-step', {
          body: nextStep
        }).then(({ error }) => {
          if (error) {
            console.error(`Failed to invoke next step:`, error);
          }
        });
      }, 100); // Small delay to ensure this function completes first
    }

    return new Response(JSON.stringify({ 
      success: true,
      step,
      image_name,
      next_step: nextStep ? `${nextStep.step} for ${nextStep.image_name}` : 'job complete'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in process-image-step:', error);
    
    // Update job status to failed
    try {
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
      const supabase = createClient(supabaseUrl, supabaseKey);
      
      const { job_id } = await req.json();
      if (job_id) {
        await supabase
          .from('processing_jobs')
          .update({ 
            status: 'failed',
            error_message: error instanceof Error ? error.message : String(error),
            completed_at: new Date().toISOString()
          })
          .eq('id', job_id);
      }
    } catch (updateError) {
      console.error('Failed to update job status:', updateError);
    }
    
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process image step', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});

async function performComposite(imageData: string, backdrop: string, placement: any, addBlur: boolean) {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not found');
  }

  // Position subject on canvas (simplified for server environment)
  const positionedData = await positionSubjectOnCanvas(imageData, 1024, 1024, placement);
  
  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image-preview",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "image/png",
    }
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
    throw new Error('Failed to generate composited image');
  }

  return { compositedData };
}

async function performFinalize(compositedData: string, guidanceData: string) {
  const geminiApiKey = Deno.env.get('GEMINI_API_KEY');
  if (!geminiApiKey) {
    throw new Error('GEMINI_API_KEY not found');
  }

  const genAI = new GoogleGenerativeAI(geminiApiKey);
  const model = genAI.getGenerativeModel({
    model: "gemini-2.5-flash-image-preview",
    generationConfig: {
      temperature: 0.2,
      responseMimeType: "image/png",
    }
  });
  
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
  
  const getImageInfo = (dataUrl: string) => {
    const [header, data] = dataUrl.split(',');
    const mimeType = header.includes('png') ? 'image/png' : 'image/jpeg';
    return { data, mimeType };
  };
  
  const compositedInfo = getImageInfo(compositedData);
  const guidanceInfo = getImageInfo(guidanceData);
  
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
  
  return { finalizedData: finalImage };
}

async function saveImageResult(supabase: any, jobId: string, imageName: string, finalizedData: string) {
  // Get current results
  const { data: job } = await supabase
    .from('processing_jobs')
    .select('processed_image_url')
    .eq('id', jobId)
    .single();

  let results = [];
  if (job?.processed_image_url) {
    try {
      results = typeof job.processed_image_url === 'string' 
        ? JSON.parse(job.processed_image_url)
        : job.processed_image_url || [];
    } catch (e) {
      console.error('Failed to parse existing results:', e);
      results = [];
    }
  }

  // Add this image's result
  results.push({
    name: imageName,
    finalizedData
  });

  // Update job with new results
  await supabase
    .from('processing_jobs')
    .update({ 
      processed_image_url: JSON.stringify(results)
    })
    .eq('id', jobId);
}

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