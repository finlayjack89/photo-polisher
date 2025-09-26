import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const supabase = createClient(supabaseUrl, supabaseKey);

interface BatchProcessingRequest {
  images: Array<{
    url: string;
    name: string;
  }>;
  operation: 'upscale' | 'compress' | 'thumbnail' | 'format_convert';
  options?: {
    quality?: number;
    scale?: number;
    format?: 'webp' | 'jpeg' | 'png';
    thumbnail_size?: number;
  };
}

interface ProcessingJob {
  id: string;
  user_id: string;
  operation: string;
  status: string;
  original_image_url: string;
  processed_image_url?: string;
  thumbnail_url?: string;
  metadata: any;
  processing_options: any;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting batch processing request');

    // Get user from JWT
    const authHeader = req.headers.get('authorization');
    if (!authHeader) {
      throw new Error('No authorization header provided');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Invalid authorization token');
    }

    const { images, operation, options = {} }: BatchProcessingRequest = await req.json();

    if (!images || !Array.isArray(images) || images.length === 0) {
      throw new Error('No images provided');
    }

    if (images.length > 10) {
      throw new Error('Maximum 10 images allowed per batch');
    }

    console.log(`Processing batch of ${images.length} images for operation: ${operation}`);

    // Check user quota
    const { data: quotaResult, error: quotaError } = await supabase
      .rpc('update_user_quota_usage', { user_id: user.id, increment: images.length });

    if (quotaError) {
      console.error('Quota check error:', quotaError);
      throw new Error('Failed to check user quota');
    }

    if (!quotaResult) {
      throw new Error('Quota exceeded. Please upgrade your plan or wait for monthly reset.');
    }

    // Create processing jobs for each image
    const jobs: ProcessingJob[] = [];
    
    for (const image of images) {
      const { data: job, error: jobError } = await supabase
        .from('processing_jobs')
        .insert({
          user_id: user.id,
          operation,
          original_image_url: image.url,
          processing_options: options,
          metadata: { 
            original_name: image.name,
            batch_id: crypto.randomUUID(),
            batch_size: images.length
          }
        })
        .select()
        .single();

      if (jobError) {
        console.error('Job creation error:', jobError);
        throw new Error('Failed to create processing job');
      }

      jobs.push(job);
    }

    // Process jobs in the background
    processBatchJobs(jobs, operation, options);

    console.log(`Created ${jobs.length} processing jobs`);

    return new Response(JSON.stringify({
      success: true,
      message: `Batch processing started for ${jobs.length} images`,
      jobs: jobs.map(job => ({
        id: job.id,
        status: job.status,
        original_url: job.original_image_url
      }))
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in batch-process-images function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function processBatchJobs(jobs: ProcessingJob[], operation: string, options: any) {
  console.log(`Processing ${jobs.length} jobs concurrently`);

  // Process jobs concurrently with a limit of 3 at a time
  const concurrencyLimit = 3;
  const chunks = [];
  
  for (let i = 0; i < jobs.length; i += concurrencyLimit) {
    chunks.push(jobs.slice(i, i + concurrencyLimit));
  }

  for (const chunk of chunks) {
    const promises = chunk.map(job => processJob(job, operation, options));
    await Promise.allSettled(promises);
  }

  console.log('Batch processing completed');
}

async function processJob(job: ProcessingJob, operation: string, options: any) {
  try {
    console.log(`Processing job ${job.id} for operation: ${operation}`);

    // Update job status to processing
    await supabase
      .from('processing_jobs')
      .update({ 
        status: 'processing', 
        started_at: new Date().toISOString() 
      })
      .eq('id', job.id);

    let processedImageUrl: string;
    let thumbnailUrl: string | undefined;

    // Check cache first
    const optionsHash = await generateHash(JSON.stringify(options));
    const { data: cacheData } = await supabase
      .rpc('get_cache_entry', {
        p_original_url: job.original_image_url,
        p_operation: operation,
        p_options_hash: optionsHash
      });

    if (cacheData && cacheData.length > 0) {
      processedImageUrl = cacheData[0].processed_url;
      console.log(`Cache hit for job ${job.id}`);
    } else {
      // Process the image
      switch (operation) {
        case 'upscale':
          processedImageUrl = await upscaleImage(job.original_image_url, options);
          break;
        case 'compress':
          processedImageUrl = await compressImage(job.original_image_url, options);
          break;
        case 'thumbnail':
          processedImageUrl = await createThumbnail(job.original_image_url, options);
          thumbnailUrl = processedImageUrl;
          break;
        case 'format_convert':
          processedImageUrl = await convertFormat(job.original_image_url, options);
          break;
        default:
          throw new Error(`Unsupported operation: ${operation}`);
      }

      // Store in cache
      await supabase
        .from('processing_cache')
        .insert({
          cache_key: await generateHash(job.original_image_url + operation + optionsHash),
          original_url: job.original_image_url,
          processed_url: processedImageUrl,
          operation,
          options_hash: optionsHash
        });
    }

    // Update job with success
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        processed_image_url: processedImageUrl,
        thumbnail_url: thumbnailUrl,
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);

    console.log(`Job ${job.id} completed successfully`);

  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);

    // Update job with error
    await supabase
      .from('processing_jobs')
      .update({
        status: 'failed',
        error_message: error instanceof Error ? error.message : String(error),
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);
  }
}

async function upscaleImage(imageUrl: string, options: any): Promise<string> {
  // Call the existing process-image function
  const { data, error } = await supabase.functions.invoke('process-image', {
    body: new FormData()
  });
  
  if (error) throw error;
  return data.processedImageUrl;
}

async function compressImage(imageUrl: string, options: any): Promise<string> {
  // Call the existing compress-images function
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  
  const { data, error } = await supabase.functions.invoke('compress-images', {
    body: {
      files: [{
        data: base64,
        name: 'image.jpg',
        type: blob.type
      }]
    }
  });

  if (error) throw error;
  return `data:${blob.type};base64,${data.compressedFiles[0].data}`;
}

async function createThumbnail(imageUrl: string, options: any): Promise<string> {
  const size = options.thumbnail_size || 150;
  
  // Simple thumbnail creation using canvas (for demo)
  // In production, you'd use a proper image processing service
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  
  // For now, return compressed version as thumbnail
  return await compressImage(imageUrl, { quality: 70 });
}

async function convertFormat(imageUrl: string, options: any): Promise<string> {
  const targetFormat = options.format || 'webp';
  
  // Use existing process-images function for format conversion
  const response = await fetch(imageUrl);
  const blob = await response.blob();
  const base64 = await blobToBase64(blob);
  
  const { data, error } = await supabase.functions.invoke('process-images', {
    body: {
      files: [{
        data: base64,
        name: `image.${targetFormat}`,
        type: `image/${targetFormat}`
      }],
      processingOptions: { format: targetFormat }
    }
  });

  if (error) throw error;
  return `data:image/${targetFormat};base64,${data.processedFiles[0].data}`;
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function generateHash(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}