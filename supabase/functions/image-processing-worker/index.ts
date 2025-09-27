import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface WorkerRequest {
  job_id: string;
}

interface JobData {
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
    const { job_id }: WorkerRequest = await req.json();
    
    console.log('Processing job:', job_id);

    // Create Supabase client
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Get job data
    const { data: job, error: fetchError } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (fetchError || !job) {
      throw new Error(`Job not found: ${fetchError?.message}`);
    }

    if (job.status !== 'pending') {
      console.log(`Job ${job_id} already processed with status: ${job.status}`);
      return new Response(JSON.stringify({ message: 'Job already processed' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const jobData = job.job_data as JobData;
    console.log(`Processing ${jobData.backgroundRemovedImages.length} images for job ${job_id}`);

    // Update status to processing
    await supabase
      .from('processing_jobs')
      .update({ status: 'processing' })
      .eq('id', job_id);

    try {
      // Step 1: Position subjects and composite
      console.log('Step 1: Positioning and compositing...');
      
      // Position all subjects on canvases
      const positionedSubjects = [];
      for (const subject of jobData.backgroundRemovedImages) {
        // Create a positioned version using canvas positioning logic
        const canvas = new OffscreenCanvas(1024, 1024); // Use standard size
        const ctx = canvas.getContext('2d');
        
        if (!ctx) {
          throw new Error('Failed to create canvas context');
        }

        // Load backdrop to get dimensions
        const backdropBlob = await fetch(jobData.backdrop).then(r => r.blob());
        const backdropBitmap = await createImageBitmap(backdropBlob);
        
        // Load subject image
        const subjectData = subject.backgroundRemovedData.replace(/^data:image\/[^;]+;base64,/, '');
        const subjectBlob = new Blob([Uint8Array.from(atob(subjectData), c => c.charCodeAt(0))], { type: 'image/png' });
        const subjectBitmap = await createImageBitmap(subjectBlob);
        
        // Clear canvas and set to backdrop dimensions
        canvas.width = backdropBitmap.width;
        canvas.height = backdropBitmap.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        
        // Calculate positioning
        const scaledWidth = subjectBitmap.width * jobData.placement.scale;
        const scaledHeight = subjectBitmap.height * jobData.placement.scale;
        const x = (canvas.width * jobData.placement.x) - (scaledWidth / 2);
        const y = (canvas.height * jobData.placement.y) - (scaledHeight / 2);
        
        // Draw positioned subject
        ctx.drawImage(subjectBitmap, x, y, scaledWidth, scaledHeight);
        
        // Convert to base64
        const blob = await canvas.convertToBlob({ type: 'image/png' });
        const arrayBuffer = await blob.arrayBuffer();
        const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
        
        positionedSubjects.push({
          name: subject.name,
          data: `data:image/png;base64,${base64}`
        });
        
        // Clean up
        backdropBitmap.close();
        subjectBitmap.close();
      }

      console.log('Positioned subjects created, calling composite-images...');

      // Call composite-images function
      const { data: compositeResult, error: compositeError } = await supabase.functions.invoke('composite-images', {
        body: {
          backdropData: jobData.backdrop,
          positionedSubjects,
          addBlur: jobData.addBlur
        }
      });

      if (compositeError) {
        throw new Error(`Compositing failed: ${compositeError.message}`);
      }

      console.log('Compositing complete, calling finalize-images...');

      // Step 2: Finalize images
      const { data: finalizeResult, error: finalizeError } = await supabase.functions.invoke('finalize-images', {
        body: {
          compositedImages: compositeResult.results.map((img: any) => ({
            name: img.name,
            data: img.compositedData
          })),
          guidanceImages: positionedSubjects
        }
      });

      if (finalizeError) {
        throw new Error(`Finalization failed: ${finalizeError.message}`);
      }

      console.log('Processing complete, updating job...');

      // Update job with results
      await supabase
        .from('processing_jobs')
        .update({ 
          status: 'complete',
          results: finalizeResult.results
        })
        .eq('id', job_id);

      console.log(`Job ${job_id} completed successfully`);

      return new Response(JSON.stringify({ 
        success: true, 
        job_id,
        results: finalizeResult.results
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });

    } catch (processingError) {
      console.error(`Processing error for job ${job_id}:`, processingError);
      
      // Update job status to failed
      await supabase
        .from('processing_jobs')
        .update({ 
          status: 'failed',
          results: { error: processingError instanceof Error ? processingError.message : String(processingError) }
        })
        .eq('id', job_id);

      throw processingError;
    }

  } catch (error) {
    console.error('Error in image-processing-worker function:', error);
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