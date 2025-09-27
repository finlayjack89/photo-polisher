import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface CloudConvertTask {
  operation: string;
  result?: {
    files?: Array<{
      data: string;
    }>;
  };
}

interface CloudConvertJob {
  data: {
    id: string;
    status: string;
    tasks: Record<string, CloudConvertTask>;
  };
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { fileData, fileName } = await req.json();
    
    if (!fileData || !fileName) {
      return new Response(
        JSON.stringify({ error: 'Missing fileData or fileName' }),
        { 
          status: 400, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      );
    }

    console.log(`Converting file: ${fileName}`);
    
    // Get CloudConvert API key from secrets
    const cloudConvertApiKey = Deno.env.get('CLOUDCONVERT_API_KEY');
    if (!cloudConvertApiKey) {
      throw new Error('CloudConvert API key not configured');
    }

    // Step 1: Create conversion job
    const jobResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${cloudConvertApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        tasks: {
          'import-file': {
            operation: 'import/base64',
            file: fileData,
            filename: fileName
          },
          'convert-file': {
            operation: 'convert',
            input: 'import-file',
            output_format: 'png',
            options: {
              quality: 95
            }
          },
          'export-file': {
            operation: 'export/base64',
            input: 'convert-file'
          }
        }
      })
    });

    if (!jobResponse.ok) {
      const errorText = await jobResponse.text();
      throw new Error(`CloudConvert job creation failed: ${errorText}`);
    }

    const job = await jobResponse.json();
    console.log('CloudConvert job created:', job.data.id);

    // Step 2: Wait for job completion with timeout
    const jobId = job.data.id;
    let attempts = 0;
    const maxAttempts = 60; // 5 minutes timeout
    let jobStatus = 'waiting';

    while (jobStatus !== 'finished' && jobStatus !== 'error' && attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 5 seconds
      attempts++;

      const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
        headers: {
          'Authorization': `Bearer ${cloudConvertApiKey}`,
        }
      });

      if (statusResponse.ok) {
        const statusData = await statusResponse.json();
        jobStatus = statusData.data.status;
        console.log(`Job status: ${jobStatus} (attempt ${attempts})`);
      } else {
        throw new Error('Failed to check job status');
      }
    }

    if (jobStatus !== 'finished') {
      throw new Error(`Job failed or timed out. Status: ${jobStatus}`);
    }

    // Step 3: Get the converted file
    const resultResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, {
      headers: {
        'Authorization': `Bearer ${cloudConvertApiKey}`,
      }
    });

    if (!resultResponse.ok) {
      throw new Error('Failed to get conversion result');
    }

    const result: CloudConvertJob = await resultResponse.json();
    const exportTask = Object.values(result.data.tasks).find((task: CloudConvertTask) => task.operation === 'export/base64');
    
    if (!exportTask?.result?.files?.[0]?.data) {
      throw new Error('No converted file data found');
    }

    const convertedFileData = exportTask.result.files[0].data;
    const convertedFileName = fileName.replace(/\.[^/.]+$/, '.png');

    console.log(`Successfully converted ${fileName} to ${convertedFileName}`);

    return new Response(
      JSON.stringify({
        success: true,
        fileData: convertedFileData,
        fileName: convertedFileName,
        originalFileName: fileName
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error: unknown) {
    console.error('CloudConvert conversion error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Conversion failed',
        success: false 
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});