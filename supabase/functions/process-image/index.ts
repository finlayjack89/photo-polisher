import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const REPLICATE_API_KEY = Deno.env.get('REPLICATE_API_KEY');
const TINIFY_API_KEY = Deno.env.get('TINIFY_API_KEY');

// Supported file types
const SUPPORTED_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const PROCESSING_TIMEOUT = 30000; // 30 seconds

interface ProcessingResult {
  success: boolean;
  processedImageUrl?: string;
  originalSize?: number;
  processedSize?: number;
  compressionRatio?: string;
  error?: string;
}

async function validateFile(file: File): Promise<void> {
  if (!SUPPORTED_TYPES.includes(file.type)) {
    throw new Error(`Unsupported file type: ${file.type}. Supported types: ${SUPPORTED_TYPES.join(', ')}`);
  }
  
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${file.size} bytes. Maximum allowed: ${MAX_FILE_SIZE} bytes`);
  }
}

async function upscaleWithReplicate(file: File): Promise<ProcessingResult> {
  if (!REPLICATE_API_KEY) {
    throw new Error('REPLICATE_API_KEY not configured');
  }

  console.log(`Starting upscaling for file: ${file.name}, size: ${file.size} bytes`);

  // Convert file to base64
  const arrayBuffer = await file.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const dataUrl = `data:${file.type};base64,${base64}`;

  // Create prediction with SwinIR model
  const predictionResponse = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      'Authorization': `Token ${REPLICATE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      version: "660d922d33153019e8c263a3bba265de882e7f4f70396546b6c9c8f9d47a021a",
      input: {
        image: dataUrl,
        scale: 4,
        useFileOutput: false
      }
    }),
  });

  if (!predictionResponse.ok) {
    const errorText = await predictionResponse.text();
    console.error(`Replicate prediction failed: ${errorText}`);
    throw new Error(`Replicate API error: ${predictionResponse.status}`);
  }

  let prediction = await predictionResponse.json();
  console.log(`Created prediction ${prediction.id} for upscaling`);

  // Poll for completion with timeout
  const startTime = Date.now();
  while (prediction.status === 'starting' || prediction.status === 'processing') {
    if (Date.now() - startTime > PROCESSING_TIMEOUT) {
      throw new Error('Processing timeout exceeded');
    }

    console.log(`Prediction ${prediction.id} status: ${prediction.status}`);
    
    // Wait 2 seconds before checking again
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const statusResponse = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: {
        'Authorization': `Token ${REPLICATE_API_KEY}`,
      },
    });

    if (!statusResponse.ok) {
      throw new Error(`Failed to check prediction status: ${statusResponse.status}`);
    }

    prediction = await statusResponse.json();
  }

  if (prediction.status === 'succeeded') {
    console.log(`Upscaling completed successfully for ${file.name}`);
    return {
      success: true,
      processedImageUrl: prediction.output,
      originalSize: file.size
    };
  } else {
    console.error(`Prediction ${prediction.id} failed with status: ${prediction.status}`);
    throw new Error(`Upscaling failed: ${prediction.status} - ${prediction.error || 'Unknown error'}`);
  }
}

async function compressWithTinify(file: File): Promise<ProcessingResult> {
  if (!TINIFY_API_KEY) {
    throw new Error('TINIFY_API_KEY not configured');
  }

  console.log(`Starting compression for file: ${file.name}, size: ${file.size} bytes`);

  const arrayBuffer = await file.arrayBuffer();
  
  try {
    // Upload to Tinify
    const compressResponse = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${btoa(`api:${TINIFY_API_KEY}`)}`,
        'Content-Type': 'application/octet-stream',
      },
      body: arrayBuffer,
    });

    if (!compressResponse.ok) {
      const errorText = await compressResponse.text();
      console.error(`Tinify compression failed: ${errorText}`);
      
      if (compressResponse.status === 429) {
        throw new Error('Compression quota exceeded. Please try again later.');
      }
      throw new Error(`Tinify API error: ${compressResponse.status}`);
    }

    const result = await compressResponse.json();
    
    // Download compressed image
    const downloadResponse = await fetch(result.output.url);
    if (!downloadResponse.ok) {
      throw new Error('Failed to download compressed image');
    }

    const compressedBuffer = await downloadResponse.arrayBuffer();
    const compressedBase64 = btoa(String.fromCharCode(...new Uint8Array(compressedBuffer)));
    const compressedDataUrl = `data:${file.type};base64,${compressedBase64}`;

    const originalSize = file.size;
    const compressedSize = compressedBuffer.byteLength;
    const compressionRatio = `${Math.round(((originalSize - compressedSize) / originalSize) * 100)}%`;

    console.log(`Compression completed: ${originalSize} -> ${compressedSize} bytes (${compressionRatio} reduction)`);

    return {
      success: true,
      processedImageUrl: compressedDataUrl,
      originalSize,
      processedSize: compressedSize,
      compressionRatio
    };
  } catch (error) {
    console.error('Compression error:', error);
    
    // Fallback: return original image as base64
    console.log('Using original image as fallback');
    const fallbackBase64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const fallbackDataUrl = `data:${file.type};base64,${fallbackBase64}`;
    
    return {
      success: true,
      processedImageUrl: fallbackDataUrl,
      originalSize: file.size,
      processedSize: file.size,
      compressionRatio: '0%'
    };
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Starting image processing request');
    
    if (req.method !== 'POST') {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Method not allowed' 
      }), {
        status: 405,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const formData = await req.formData();
    const file = formData.get('file') as File;
    const operation = formData.get('operation') as string;

    if (!file) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'No file provided' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!operation || !['upscale', 'compress'].includes(operation)) {
      return new Response(JSON.stringify({ 
        success: false,
        error: 'Invalid operation. Must be "upscale" or "compress"' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Processing ${operation} operation for file: ${file.name}`);

    // Validate file
    await validateFile(file);

    let result: ProcessingResult;

    if (operation === 'upscale') {
      result = await upscaleWithReplicate(file);
    } else {
      result = await compressWithTinify(file);
    }

    console.log(`${operation} operation completed successfully`);

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in process-image function:', error);
    
    let errorMessage = 'Unknown error occurred';
    let statusCode = 500;

    if (error instanceof Error) {
      errorMessage = error.message;
      
      if (error.message.includes('Unsupported file type') || 
          error.message.includes('File too large') ||
          error.message.includes('Invalid operation')) {
        statusCode = 400;
      } else if (error.message.includes('quota exceeded')) {
        statusCode = 429;
      } else if (error.message.includes('timeout')) {
        statusCode = 408;
      }
    }

    return new Response(JSON.stringify({ 
      success: false,
      error: errorMessage 
    }), {
      status: statusCode,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});