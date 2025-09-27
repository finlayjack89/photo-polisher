import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { job_id } = await req.json();
    
    if (!job_id) {
      throw new Error('No job_id provided');
    }

    console.log(`Processing job ${job_id}`);
    
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch job data
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      throw new Error(`Job not found: ${jobError?.message}`);
    }

    console.log(`Found job ${job_id} with ${job.metadata.backgroundRemovedImages.length} images`);

    // Update job status to processing
    await supabase
      .from('processing_jobs')
      .update({ status: 'processing' })
      .eq('id', job_id);

    const { backgroundRemovedImages, backdrop, placement, addBlur } = job.metadata;
    const results = [];
    let processedCount = 0;

    try {
      // Process each image individually using the new process-single-image function
      for (let i = 0; i < backgroundRemovedImages.length; i++) {
        const subject = backgroundRemovedImages[i];
        console.log(`Processing image ${i + 1}/${backgroundRemovedImages.length}: ${subject.name}`);

        try {
          // Call the new process-single-image function
          const { data: processResult, error: processError } = await supabase.functions.invoke('process-single-image', {
            body: {
              imageUrl: subject.backgroundRemovedData,
              imageName: subject.name,
              backdrop,
              placement,
              addBlur
            }
          });

          if (processError || !processResult?.success) {
            throw new Error(`Failed to process ${subject.name}: ${processError?.message || processResult?.error}`);
          }

          results.push(processResult.result);
          processedCount++;

          console.log(`Successfully processed ${subject.name} (${processedCount}/${backgroundRemovedImages.length})`);

          // Update job with current progress
          await supabase
            .from('processing_jobs')
            .update({ 
              metadata: {
                ...job.metadata,
                processedCount,
                totalCount: backgroundRemovedImages.length,
                currentStatus: `Processing ${processedCount}/${backgroundRemovedImages.length} images...`
              }
            })
            .eq('id', job_id);

        } catch (imageError) {
          console.error(`Failed to process image ${subject.name}:`, imageError);
          // Continue with other images but log the failure
          results.push({
            name: subject.name,
            error: imageError instanceof Error ? imageError.message : String(imageError)
          });
        }
      }

      // Update job with results using existing schema
      await supabase
        .from('processing_jobs')
        .update({ 
          status: 'completed',
          processed_image_url: JSON.stringify(results),
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);

      console.log(`Job ${job_id} completed successfully with ${results.length} processed images`);

    } catch (processingError) {
      console.error('Processing error:', processingError);
      
      // Update job status to failed using existing schema
      await supabase
        .from('processing_jobs')
        .update({ 
          status: 'failed',
          error_message: processingError instanceof Error ? processingError.message : String(processingError),
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);

      throw processingError;
    }

    return new Response(JSON.stringify({ 
      success: true,
      job_id: job_id,
      results_count: results.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in image-processing-worker:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to process images', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});