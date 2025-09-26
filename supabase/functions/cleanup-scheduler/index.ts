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
    console.log('Starting cleanup scheduler');

    const url = new URL(req.url);
    const action = url.searchParams.get('action') || 'full';

    let results: any = {};

    switch (action) {
      case 'expired_jobs':
        results.expired_jobs = await cleanupExpiredJobs();
        break;
      case 'expired_cache':
        results.expired_cache = await cleanupExpiredCache();
        break;
      case 'storage':
        results.storage = await cleanupOrphanedStorage();
        break;
      case 'quotas':
        results.quotas = await resetExpiredQuotas();
        break;
      case 'full':
      default:
        results.expired_jobs = await cleanupExpiredJobs();
        results.expired_cache = await cleanupExpiredCache();
        results.storage = await cleanupOrphanedStorage();
        results.quotas = await resetExpiredQuotas();
        break;
    }

    // Update system health metrics
    await updateSystemHealth('cleanup_completed', 1, results);

    console.log('Cleanup completed:', results);

    return new Response(JSON.stringify({
      success: true,
      message: 'Cleanup completed successfully',
      results
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in cleanup-scheduler function:', error);
    
    await updateSystemHealth('cleanup_failed', 1, { 
      error: error instanceof Error ? error.message : String(error) 
    });

    return new Response(JSON.stringify({
      success: false,
      error: error instanceof Error ? error.message : String(error)
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function cleanupExpiredJobs() {
  console.log('Cleaning up expired processing jobs...');

  // Get expired jobs before deletion for storage cleanup
  const { data: expiredJobs, error: fetchError } = await supabase
    .from('processing_jobs')
    .select('id, processed_image_url, thumbnail_url')
    .lt('expires_at', new Date().toISOString());

  if (fetchError) {
    console.error('Error fetching expired jobs:', fetchError);
    throw fetchError;
  }

  if (!expiredJobs || expiredJobs.length === 0) {
    console.log('No expired jobs found');
    return { deleted: 0 };
  }

  // Clean up associated storage files
  for (const job of expiredJobs) {
    try {
      if (job.processed_image_url) {
        await cleanupStorageFile(job.processed_image_url);
      }
      if (job.thumbnail_url) {
        await cleanupStorageFile(job.thumbnail_url);
      }
    } catch (error) {
      console.warn(`Failed to cleanup storage for job ${job.id}:`, error);
    }
  }

  // Delete expired jobs using the database function
  const { data: cleanupResult, error: cleanupError } = await supabase
    .rpc('cleanup_expired_data');

  if (cleanupError) {
    console.error('Error cleaning up expired data:', cleanupError);
    throw cleanupError;
  }

  console.log(`Cleaned up ${cleanupResult[0]?.jobs_deleted || 0} expired jobs`);
  return { deleted: cleanupResult[0]?.jobs_deleted || 0 };
}

async function cleanupExpiredCache() {
  console.log('Cleaning up expired cache entries...');

  const { data: cleanupResult, error } = await supabase
    .rpc('cleanup_expired_data');

  if (error) {
    console.error('Error cleaning up expired cache:', error);
    throw error;
  }

  console.log(`Cleaned up ${cleanupResult[0]?.cache_deleted || 0} expired cache entries`);
  return { deleted: cleanupResult[0]?.cache_deleted || 0 };
}

async function cleanupOrphanedStorage() {
  console.log('Cleaning up orphaned storage files...');

  let deletedFiles = 0;

  try {
    // Get all files from processed-images bucket
    const { data: processedFiles, error: processedError } = await supabase
      .storage
      .from('processed-images')
      .list();

    if (processedError) throw processedError;

    // Get all files from thumbnails bucket
    const { data: thumbnailFiles, error: thumbnailError } = await supabase
      .storage
      .from('thumbnails')
      .list();

    if (thumbnailError) throw thumbnailError;

    // Check for orphaned files (files not referenced in processing_jobs)
    const allFiles = [
      ...(processedFiles || []).map(f => ({ ...f, bucket: 'processed-images' })),
      ...(thumbnailFiles || []).map(f => ({ ...f, bucket: 'thumbnails' }))
    ];

    for (const file of allFiles) {
      if (file.name === '.emptyFolderPlaceholder') continue;

      const fileUrl = `${supabaseUrl}/storage/v1/object/public/${file.bucket}/${file.name}`;
      
      // Check if file is referenced in any job
      const { data: referencedJobs, error: refError } = await supabase
        .from('processing_jobs')
        .select('id')
        .or(`processed_image_url.eq.${fileUrl},thumbnail_url.eq.${fileUrl}`)
        .limit(1);

      if (refError) {
        console.warn(`Error checking references for ${file.name}:`, refError);
        continue;
      }

      // If no references and file is older than 30 days, delete it
      if (!referencedJobs || referencedJobs.length === 0) {
        const fileDate = new Date(file.created_at || file.updated_at);
        const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

        if (fileDate < thirtyDaysAgo) {
          const { error: deleteError } = await supabase
            .storage
            .from(file.bucket)
            .remove([file.name]);

          if (deleteError) {
            console.warn(`Failed to delete orphaned file ${file.name}:`, deleteError);
          } else {
            deletedFiles++;
            console.log(`Deleted orphaned file: ${file.name}`);
          }
        }
      }
    }

  } catch (error) {
    console.error('Error during storage cleanup:', error);
  }

  console.log(`Cleaned up ${deletedFiles} orphaned storage files`);
  return { deleted: deletedFiles };
}

async function resetExpiredQuotas() {
  console.log('Resetting expired monthly quotas...');

  const { data: resetCount, error } = await supabase
    .rpc('reset_monthly_quotas');

  if (error) {
    console.error('Error resetting quotas:', error);
    throw error;
  }

  console.log(`Reset ${resetCount || 0} expired quotas`);
  return { reset: resetCount || 0 };
}

async function cleanupStorageFile(fileUrl: string) {
  try {
    // Extract bucket and file path from URL
    const urlParts = fileUrl.split('/storage/v1/object/public/');
    if (urlParts.length < 2) return;

    const [bucket, ...pathParts] = urlParts[1].split('/');
    const filePath = pathParts.join('/');

    await supabase
      .storage
      .from(bucket)
      .remove([filePath]);

  } catch (error) {
    console.warn(`Failed to cleanup storage file ${fileUrl}:`, error);
  }
}

async function updateSystemHealth(metricName: string, value: number, metadata: any = {}) {
  try {
    await supabase
      .from('system_health')
      .insert({
        metric_name: metricName,
        metric_value: value,
        metadata
      });
  } catch (error) {
    console.warn('Failed to update system health:', error);
  }
}