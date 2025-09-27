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

    const { backgroundRemovedImages, backdrop, placement, addBlur } = job.metadata;
    
    console.log(`Found job ${job_id} with ${backgroundRemovedImages?.length || 0} images`);
    console.log('Job metadata:', { hasBackdrop: !!backdrop, placement, addBlur });
    
    if (!backgroundRemovedImages || backgroundRemovedImages.length === 0) {
      await supabase
        .from('processing_jobs')
        .update({ 
          status: 'completed',
          processed_image_url: JSON.stringify([]),
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);
      
      console.log(`No images to process for job ${job_id}`);
      return new Response(JSON.stringify({ 
        success: true,
        job_id: job_id,
        message: 'No images to process'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Update job status to processing and initialize metadata
    await supabase
      .from('processing_jobs')
      .update({ 
        status: 'processing',
        metadata: {
          ...job.metadata,
          processedCount: 0,
          totalCount: backgroundRemovedImages.length,
          currentStatus: 'Starting sequential image processing...'
        },
        started_at: new Date().toISOString()
      })
      .eq('id', job_id);

    const processedResults = [];
    
    // Process images sequentially using for...of loop
    for (let i = 0; i < backgroundRemovedImages.length; i++) {
      const image = backgroundRemovedImages[i];
      console.log(`Processing image ${i + 1}/${backgroundRemovedImages.length}: ${image.name}`);
      
      try {
        // Update current status
        await supabase
          .from('processing_jobs')
          .update({ 
            metadata: {
              ...job.metadata,
              processedCount: i,
              totalCount: backgroundRemovedImages.length,
              currentStatus: `Processing image ${i + 1} of ${backgroundRemovedImages.length}: ${image.name}`
            }
          })
          .eq('id', job_id);

        // Process single image
        const requestBody = {
          imageUrl: image.backgroundRemovedData,
          imageName: image.name,
          backdrop: backdrop,
          placement: placement || { x: 0.5, y: 0.5, scale: 1.0 },
          addBlur: addBlur || false
        };
        
        console.log('Sending to process-single-image:', {
          imageName: requestBody.imageName,
          hasImageUrl: !!requestBody.imageUrl,
          hasBackdrop: !!requestBody.backdrop,
          placement: requestBody.placement,
          addBlur: requestBody.addBlur
        });
        
        const { data: result, error: processError } = await supabase.functions.invoke('process-single-image', {
          body: requestBody
        });

        if (processError) {
          console.error(`Process error for ${image.name}:`, processError);
          throw new Error(`Failed to process image ${image.name}: ${processError.message}`);
        }

        console.log(`Raw result structure for ${image.name}:`, JSON.stringify(result, null, 2));

        // Fix response structure access: result.result.finalizedData (not result.finalizedData)
        if (result?.result?.finalizedData) {
          processedResults.push({
            name: image.name,
            url: result.result.finalizedData
          });
          console.log(`Successfully processed image ${image.name}`);
        } else {
          console.error(`Invalid result structure for ${image.name}:`, {
            hasResult: !!result,
            hasResultProperty: !!result?.result,
            hasFinalizedData: !!result?.result?.finalizedData,
            resultKeys: result ? Object.keys(result) : 'no result',
            resultResultKeys: result?.result ? Object.keys(result.result) : 'no result.result'
          });
          throw new Error(`No processed data returned for image ${image.name}. Expected result.result.finalizedData but got: ${JSON.stringify(result)}`);
        }

        // Update progress
        await supabase
          .from('processing_jobs')
          .update({ 
            metadata: {
              ...job.metadata,
              processedCount: i + 1,
              totalCount: backgroundRemovedImages.length,
              currentStatus: `Completed image ${i + 1} of ${backgroundRemovedImages.length}: ${image.name}`
            }
          })
          .eq('id', job_id);

      } catch (error) {
        console.error(`Error processing image ${image.name}:`, error);
        
        // Update job to failed
        await supabase
          .from('processing_jobs')
          .update({ 
            status: 'failed',
            error_message: `Failed to process image ${image.name}: ${error instanceof Error ? error.message : String(error)}`,
            completed_at: new Date().toISOString()
          })
          .eq('id', job_id);
        
        throw error;
      }
    }

    // All images processed successfully
    await supabase
      .from('processing_jobs')
      .update({ 
        status: 'completed',
        processed_image_url: JSON.stringify(processedResults),
        completed_at: new Date().toISOString(),
        metadata: {
          ...job.metadata,
          processedCount: backgroundRemovedImages.length,
          totalCount: backgroundRemovedImages.length,
          currentStatus: 'All images processed successfully'
        }
      })
      .eq('id', job_id);

    console.log(`Job ${job_id} completed successfully with ${processedResults.length} processed images`);

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