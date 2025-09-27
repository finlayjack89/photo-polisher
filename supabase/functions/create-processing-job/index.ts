import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface JobData {
  backgroundRemovedImages: Array<{
    name: string;
    originalData: string;
    backgroundRemovedData: string;
    size: number;
  }>;
  backdrop: string;
  placement: any;
  addBlur: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { backgroundRemovedImages, backdrop, placement, addBlur }: JobData = await req.json();
    
    // Get Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Get user ID from JWT
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    const { data: { user }, error: userError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    console.log(`Creating processing job for user ${user.id}`);

    // Optimize data storage to prevent timeout
    // Store only essential data, not full base64 images
    const optimizedBackgroundImages = backgroundRemovedImages.map(img => ({
      name: img.name,
      size: img.size,
      // Store a hash or truncated preview instead of full data
      dataPreview: img.backgroundRemovedData.substring(0, 100) + '...',
      hasData: !!img.backgroundRemovedData
    }));

    // For backdrop, store only a preview if it's very large
    let optimizedBackdrop = backdrop;
    if (backdrop && backdrop.length > 50000) { // If larger than ~37KB base64
      console.log(`Backdrop is large (${backdrop.length} chars), storing preview only`);
      optimizedBackdrop = backdrop.substring(0, 100) + '...';
    }

    console.log(`Storing optimized data: ${optimizedBackgroundImages.length} images, backdrop length: ${optimizedBackdrop.length}`);

    // Create job in database with timeout protection
    const insertPromise = supabase
      .from('processing_jobs')
      .insert({
        user_id: user.id,
        status: 'pending',
        operation: 'composite',
        original_image_url: 'composite-job', // Required field for composite operations
        metadata: {
          backgroundRemovedImages: optimizedBackgroundImages,
          backdrop: optimizedBackdrop,
          placement,
          addBlur,
          // Store the actual data separately in processing_options for the worker
          hasLargeData: true
        },
        // Store the actual processing data in a separate field
        processing_options: {
          backgroundRemovedImages,
          backdrop,
          placement,
          addBlur
        }
      })
      .select()
      .single();

    // Add timeout to the database operation
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Database operation timed out after 10 seconds')), 10000);
    });

    const { data: job, error: jobError } = await Promise.race([
      insertPromise,
      timeoutPromise
    ]) as any;

    if (jobError) {
      console.error('Error creating job:', jobError);
      throw jobError;
    }

    console.log(`Created job ${job.id} for ${backgroundRemovedImages.length} images`);

    // Trigger processing queue to start processing this job - use direct function invocation
    try {
      console.log('Triggering image processing worker for job:', job.id);
      
      // Call image-processing-worker directly instead of processing-queue
      const { error: workerError } = await supabase.functions.invoke('image-processing-worker', {
        body: { job_id: job.id }
      });
      
      if (workerError) {
        console.error('Failed to invoke image-processing-worker:', workerError);
      } else {
        console.log('Image processing worker invoked successfully for job', job.id);
      }
    } catch (workerError) {
      console.error('Error invoking image-processing-worker:', workerError);
      // Don't fail the job creation if worker invocation fails - job will remain pending
    }

    return new Response(JSON.stringify({ 
      job_id: job.id,
      status: 'pending',
      message: 'Processing job created successfully'
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in create-processing-job function:', error);
    return new Response(
      JSON.stringify({ 
        error: 'Failed to create processing job', 
        details: error instanceof Error ? error.message : String(error)
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});