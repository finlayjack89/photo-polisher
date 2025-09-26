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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'status';

    switch (action) {
      case 'status':
        return await getQueueStatus();
      case 'process':
        return await processQueue();
      case 'cancel':
        return await cancelJob(url.searchParams.get('job_id'));
      case 'retry':
        return await retryJob(url.searchParams.get('job_id'));
      case 'health':
        return await getSystemHealth();
      default:
        throw new Error('Invalid action');
    }

  } catch (error) {
    console.error('Error in processing-queue function:', error);
    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function getQueueStatus() {
  const { data: queueStats, error } = await supabase
    .from('processing_jobs')
    .select('status')
    .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString());

  if (error) throw error;

  const stats = queueStats.reduce((acc: any, job: any) => {
    acc[job.status] = (acc[job.status] || 0) + 1;
    return acc;
  }, {});

  return new Response(JSON.stringify({
    success: true,
    queue_stats: {
      pending: stats.pending || 0,
      processing: stats.processing || 0,
      completed: stats.completed || 0,
      failed: stats.failed || 0,
      cancelled: stats.cancelled || 0,
      total: queueStats.length
    },
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function processQueue() {
  console.log('Processing queue...');

  // Get pending jobs (limit to 10 at a time)
  const { data: pendingJobs, error } = await supabase
    .from('processing_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(10);

  if (error) throw error;

  if (!pendingJobs || pendingJobs.length === 0) {
    return new Response(JSON.stringify({
      success: true,
      message: 'No pending jobs to process',
      processed: 0
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }

  console.log(`Found ${pendingJobs.length} pending jobs`);

  // Process jobs in background
  processJobs(pendingJobs);

  // Update system health metrics
  await updateSystemHealth('queue_processing', pendingJobs.length);

  return new Response(JSON.stringify({
    success: true,
    message: `Started processing ${pendingJobs.length} jobs`,
    processed: pendingJobs.length
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function processJobs(jobs: any[]) {
  const concurrentLimit = 3;
  
  for (let i = 0; i < jobs.length; i += concurrentLimit) {
    const batch = jobs.slice(i, i + concurrentLimit);
    const promises = batch.map(job => processIndividualJob(job));
    await Promise.allSettled(promises);
  }
}

async function processIndividualJob(job: any) {
  try {
    console.log(`Processing job ${job.id} - ${job.operation}`);

    // Update status to processing
    await supabase
      .from('processing_jobs')
      .update({ 
        status: 'processing', 
        started_at: new Date().toISOString() 
      })
      .eq('id', job.id);

    // Call appropriate processing function based on operation
    let result;
    switch (job.operation) {
      case 'upscale':
        result = await supabase.functions.invoke('upscale-images', {
          body: {
            files: [{ 
              name: job.metadata?.original_name || 'image.jpg',
              data: await urlToBase64(job.original_image_url)
            }]
          }
        });
        break;
      
      case 'compress':
        result = await supabase.functions.invoke('compress-images', {
          body: {
            files: [{ 
              name: job.metadata?.original_name || 'image.jpg',
              data: await urlToBase64(job.original_image_url)
            }]
          }
        });
        break;
      
      default:
        throw new Error(`Unsupported operation: ${job.operation}`);
    }

    if (result.error) throw result.error;

    // Update job with success
    const processedUrl = result.data?.upscaledFiles?.[0]?.data || result.data?.compressedFiles?.[0]?.data;
    
    await supabase
      .from('processing_jobs')
      .update({
        status: 'completed',
        processed_image_url: processedUrl ? `data:image/png;base64,${processedUrl}` : job.original_image_url,
        completed_at: new Date().toISOString()
      })
      .eq('id', job.id);

    console.log(`Job ${job.id} completed successfully`);

  } catch (error) {
    console.error(`Job ${job.id} failed:`, error);

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

async function cancelJob(jobId: string | null) {
  if (!jobId) throw new Error('Job ID required');

  const { error } = await supabase
    .from('processing_jobs')
    .update({ 
      status: 'cancelled',
      completed_at: new Date().toISOString()
    })
    .eq('id', jobId)
    .in('status', ['pending', 'processing']);

  if (error) throw error;

  return new Response(JSON.stringify({
    success: true,
    message: `Job ${jobId} cancelled`
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function retryJob(jobId: string | null) {
  if (!jobId) throw new Error('Job ID required');

  const { error } = await supabase
    .from('processing_jobs')
    .update({ 
      status: 'pending',
      error_message: null,
      started_at: null,
      completed_at: null
    })
    .eq('id', jobId)
    .eq('status', 'failed');

  if (error) throw error;

  return new Response(JSON.stringify({
    success: true,
    message: `Job ${jobId} queued for retry`
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function getSystemHealth() {
  // Get recent health metrics
  const { data: healthData, error } = await supabase
    .from('system_health')
    .select('*')
    .gte('recorded_at', new Date(Date.now() - 60 * 60 * 1000).toISOString()) // Last hour
    .order('recorded_at', { ascending: false });

  if (error) throw error;

  // Calculate averages and current values
  const metrics = healthData.reduce((acc: any, record: any) => {
    if (!acc[record.metric_name]) {
      acc[record.metric_name] = { values: [], latest: 0 };
    }
    acc[record.metric_name].values.push(record.metric_value);
    acc[record.metric_name].latest = record.metric_value;
    return acc;
  }, {});

  // Calculate averages
  Object.keys(metrics).forEach(key => {
    const values = metrics[key].values;
    metrics[key].average = values.reduce((a: number, b: number) => a + b, 0) / values.length;
  });

  return new Response(JSON.stringify({
    success: true,
    health_metrics: metrics,
    timestamp: new Date().toISOString()
  }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

async function updateSystemHealth(metricName: string, value: number, metadata: any = {}) {
  await supabase
    .from('system_health')
    .insert({
      metric_name: metricName,
      metric_value: value,
      metadata
    });
}

async function urlToBase64(url: string): Promise<string> {
  const response = await fetch(url);
  const blob = await response.blob();
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}