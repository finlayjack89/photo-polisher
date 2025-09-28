import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const CLOUDCONVERT_API_KEY = Deno.env.get('CLOUDCONVERT_API_KEY');

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting image processing request');
    
    const { files, processingOptions = {} } = await req.json();
    
    if (!files || !Array.isArray(files)) {
      throw new Error('No files provided or invalid format');
    }

    console.log(`Processing ${files.length} files`);
    
    const processedFiles = [];

    for (const file of files) {
      const { data, name, type } = file;
      
      console.log(`Processing file: ${name}, type: ${type}`);
      
      // Create a job in CloudConvert - simplified workflow
      const jobResponse = await fetch('https://api.cloudconvert.com/v2/jobs', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${CLOUDCONVERT_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          tasks: {
            'import-file': {
              operation: 'import/base64',
              file: data,
              filename: name,
            },
            'convert-file': {
              operation: 'convert',
              input: 'import-file',
              output_format: 'png',
              engine: 'imagemagick',
              engine_options: {
                quality: processingOptions.quality || 95,
                strip: true,
                background: 'transparent'
              }
            },
            'export-file': {
              operation: 'export/url',
              input: 'convert-file'
            }
          }
        }),
      });

      if (!jobResponse.ok) {
        const errorText = await jobResponse.text();
        console.error(`CloudConvert job creation failed: ${errorText}`);
        throw new Error(`Failed to create conversion job: ${jobResponse.status}`);
      }

      const job = await jobResponse.json();
      console.log(`Created job ${job.data.id} for file ${name}`);

      // Wait for job completion
      let jobStatus = job.data;
      while (jobStatus.status === 'waiting' || jobStatus.status === 'processing') {
        console.log(`Job ${jobStatus.id} status: ${jobStatus.status}`);
        
        // Wait 2 seconds before checking again
        await new Promise(resolve => setTimeout(resolve, 2000));
        
        const statusResponse = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobStatus.id}`, {
          headers: {
            'Authorization': `Bearer ${CLOUDCONVERT_API_KEY}`,
          },
        });

        if (!statusResponse.ok) {
          throw new Error(`Failed to check job status: ${statusResponse.status}`);
        }

        const statusData = await statusResponse.json();
        jobStatus = statusData.data;
      }

      if (jobStatus.status === 'finished') {
        // Get the export task result
        const exportTask = jobStatus.tasks.find((task: any) => task.name === 'export-file');
        
        if (exportTask && exportTask.result && exportTask.result.files && exportTask.result.files.length > 0) {
          const resultFile = exportTask.result.files[0];
          console.log(`Export task result for ${name}:`, { 
            filename: resultFile.filename, 
            size: resultFile.size,
            url: resultFile.url ? 'URL provided' : 'No URL'
          });
          
          if (!resultFile.url) {
            throw new Error(`No download URL provided for ${name}`);
          }
          
          // Download the file from CloudConvert
          const fileResponse = await fetch(resultFile.url);
          
          if (!fileResponse.ok) {
            console.error(`Download failed for ${name}: ${fileResponse.status} ${fileResponse.statusText}`);
            throw new Error(`Failed to download processed file for ${name}: ${fileResponse.status}`);
          }
          
          const fileBuffer = await fileResponse.arrayBuffer();
          console.log(`Downloaded ${name}: ${fileBuffer.byteLength} bytes`);
          
          // Convert to base64
          const base64Data = `data:image/png;base64,${btoa(String.fromCharCode(...new Uint8Array(fileBuffer)))}`;
          
          processedFiles.push({
            originalName: name,
            processedName: name.replace(/\.[^/.]+$/, '.png'),
            data: base64Data,
            size: fileBuffer.byteLength,
            format: 'png'
          });
          
          console.log(`Successfully processed ${name} to PNG format`);
        } else {
          console.error(`No result file found for job ${jobStatus.id}`);
          throw new Error(`No result file found for ${name}`);
        }
      } else {
        console.error(`Job ${jobStatus.id} failed with status: ${jobStatus.status}`);
        throw new Error(`Conversion failed for ${name}: ${jobStatus.status}`);
      }
    }

    console.log(`Successfully processed ${processedFiles.length} files`);

    return new Response(JSON.stringify({ 
      success: true,
      processedFiles,
      message: `Successfully processed ${processedFiles.length} images`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in process-images function:', error);
    return new Response(JSON.stringify({ 
      success: false,
      error: error instanceof Error ? error.message : String(error) 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});