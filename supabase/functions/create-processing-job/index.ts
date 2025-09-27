import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CreateJobRequest {
  backgroundRemovedImages: Array<{
    name: string;
    originalData: string;
    backgroundRemovedData: string;
    size: number;
  }>;
  backdrop: string;
  placement: {
    scale: number;
    x: number;
    y: number;
    rotation?: number;
  };
  addBlur: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('No authorization header');
    }

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Get user from JWT
    const jwt = authHeader.replace('Bearer ', '');
    const { data: { user }, error: userError } = await supabase.auth.getUser(jwt);
    
    if (userError || !user) {
      throw new Error('Invalid user token');
    }

    const requestData: CreateJobRequest = await req.json();
    
    console.log('Creating processing job for user:', user.id);
    console.log('Job data:', {
      imagesCount: requestData.backgroundRemovedImages.length,
      hasBackdrop: !!requestData.backdrop,
      hasPlacement: !!requestData.placement
    });

    // Insert job into database
    const { data: job, error: insertError } = await supabase
      .from('processing_jobs')
      .insert({
        user_id: user.id,
        status: 'pending',
        job_data: {
          backgroundRemovedImages: requestData.backgroundRemovedImages,
          backdrop: requestData.backdrop,
          placement: requestData.placement,
          addBlur: requestData.addBlur
        }
      })
      .select()
      .single();

    if (insertError) {
      console.error('Database insert error:', insertError);
      throw new Error(`Failed to create job: ${insertError.message}`);
    }

    console.log('Job created successfully:', job.id);

    // Trigger the worker function immediately
    const { error: workerError } = await supabase.functions.invoke('image-processing-worker', {
      body: { job_id: job.id }
    });

    if (workerError) {
      console.error('Failed to trigger worker:', workerError);
      // Don't throw error as job is created, worker can be triggered manually
    }

    return new Response(JSON.stringify({ job_id: job.id }), {
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