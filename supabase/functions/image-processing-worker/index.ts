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

    console.log(`Starting orchestration for job ${job_id}`);
    
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

    const { backgroundRemovedImages } = job.metadata;
    console.log(`Found job ${job_id} with ${backgroundRemovedImages.length} images`);

    // Update job status to processing and initialize metadata
    await supabase
      .from('processing_jobs')
      .update({ 
        status: 'processing',
        metadata: {
          ...job.metadata,
          processedCount: 0,
          totalCount: backgroundRemovedImages.length,
          currentStatus: 'Starting image processing...'
        }
      })
      .eq('id', job_id);

    // Start processing with the first image
    if (backgroundRemovedImages.length > 0) {
      const firstImage = backgroundRemovedImages[0];
      console.log(`Starting processing with first image: ${firstImage.name}`);
      
      // Use background task to start the processing chain
      supabase.functions.invoke('process-image-step', {
        body: {
          job_id,
          image_name: firstImage.name,
          step: 'composite',
          image_data: firstImage.backgroundRemovedData
        }
      }).then(({ error }) => {
        if (error) {
          console.error(`Failed to start processing chain:`, error);
          // Update job to failed if we can't start processing
          supabase
            .from('processing_jobs')
            .update({ 
              status: 'failed',
              error_message: `Failed to start processing: ${error.message}`,
              completed_at: new Date().toISOString()
            })
            .eq('id', job_id);
        }
      });
      
      console.log(`Job ${job_id} orchestration started successfully`);
    } else {
      // No images to process
      await supabase
        .from('processing_jobs')
        .update({ 
          status: 'completed',
          processed_image_url: JSON.stringify([]),
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);
    }

    return new Response(JSON.stringify({ 
      success: true,
      job_id: job_id,
      message: 'Processing started'
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