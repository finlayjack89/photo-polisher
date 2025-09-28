import { v4 as uuidv4 } from 'uuid';
import React, { useState, useCallback, useRef } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useDropzone } from 'react-dropzone';
import { X, Upload, FileImage } from 'lucide-react';
import { processAndCompressImage } from "@/lib/image-resize-utils";
import { supabase } from "@/integrations/supabase/client";
// @ts-ignore - HEIC library types not available
import heic2any from 'heic2any';

interface UploadZoneProps {
  onFilesUploaded: (files: File[]) => void;
}

interface FileWithOriginalSize extends File {
  originalSize?: number;
}

export const UploadZone: React.FC<UploadZoneProps> = ({ onFilesUploaded }) => {
  const [selectedFiles, setSelectedFiles] = useState<FileWithOriginalSize[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);

  // Convert HEIC to PNG
  const convertHeicToPng = async (file: File): Promise<File> => {
    try {
      const convertedBlob = await heic2any({
        blob: file,
        toType: "image/png",
      });
      
      const blob = Array.isArray(convertedBlob) ? convertedBlob[0] : convertedBlob;
      return new File([blob], file.name.replace(/\.[^/.]+$/, '.png'), {
        type: 'image/png',
        lastModified: Date.now(),
      });
    } catch (error) {
      console.error('HEIC conversion failed:', error);
      throw error;
    }
  };

  const convertFileWithCloudConvert = async (file: File): Promise<File> => {
    try {
      console.log(`Converting ${file.name} using CloudConvert...`);
      
      // Convert file to base64
      const base64Data = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          // Remove the data URL prefix to get just the base64 data
          const base64 = result.split(',')[1];
          resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });

      const { data, error } = await supabase.functions.invoke('convert-file-to-png', {
        body: {
          fileData: base64Data,
          fileName: file.name
        }
      });

      if (error || !data.success) {
        throw new Error(data?.error || 'CloudConvert conversion failed');
      }

      // Convert base64 back to File
      const binaryString = atob(data.fileData);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      
      return new File([bytes], data.fileName, { type: 'image/png' });
    } catch (error) {
      console.error('CloudConvert conversion failed:', error);
      throw error;
    }
  };

const onDrop = async (acceptedFiles: File[]) => {
  const validFiles = acceptedFiles.filter(file => {
    const isValidType = file.type.startsWith('image/') || 
                        file.name.toLowerCase().endsWith('.heic') ||
                        file.name.toLowerCase().endsWith('.cr2') ||
                        file.name.toLowerCase().endsWith('.nef') ||
                        file.name.toLowerCase().endsWith('.arw');
    const isValidSize = file.size <= 50 * 1024 * 1024; // 50MB limit
    return isValidType && isValidSize;
  });

  if (validFiles.length + selectedFiles.length > 20) {
    console.error("Cannot upload more than 20 images.");
    // Consider adding a toast notification for the user here
    return;
  }

  try {
    const processedFiles: FileWithOriginalSize[] = [];
    const newPreviews: string[] = [];

    for (const file of validFiles) {
      let fileToProcess: File | Blob = file;
      const originalSize = file.size;

      // --- CORRECTED LOGIC ---
      // Define standard web formats that do NOT need conversion
      const isStandardWebFormat = file.type === 'image/jpeg' || 
                                  file.type === 'image/png' || 
                                  file.type === 'image/webp';

      const needsConversion = !isStandardWebFormat;

      if (needsConversion) {
        console.log(`Conversion needed for ${file.name} (${file.type})`);
        try {
          if (file.name.toLowerCase().endsWith('.heic')) {
            // Convert HEIC to a lossless PNG to preserve quality for the next step
            fileToProcess = await heic2any({ blob: file, toType: "image/png" });
          } else {
            console.warn(`File type ${file.type} requires a server-side converter.`);
            // Here you would ideally call a server-side function for RAW files.
            // For now, we will skip these files.
            toast({
              title: "Unsupported File Type",
              description: `Automatic conversion for ${file.name} is not yet supported.`,
              variant: "destructive"
            });
            continue; 
          }
        } catch (conversionError) {
          console.error(`Failed to convert ${file.name}:`, conversionError);
          toast({
            title: "Conversion Failed",
            description: `Could not process ${file.name}. Please try a different file.`,
            variant: "destructive"
          });
          continue; // Skip to the next file
        }
      }

      // --- All files (original or converted) now go through the proper compression logic ---
      let finalFile: FileWithOriginalSize;
const FIVE_MB = 5 * 1024 * 1024;

// --- THIS IS THE FIX ---
// Only process the image if it's larger than 5MB.
// Your processAndCompressImage function already handles the 2048px resize,
// so we only need to check the file size here.
if (originalSize > FIVE_MB) {
  console.log(`Processing image: ${file.name}, original size: ${(originalSize / (1024 * 1024)).toFixed(2)}MB`);
  const compressedBlob = await processAndCompressImage(fileToProcess as File);

  finalFile = new File([compressedBlob], file.name.replace(/\.[^/.]+$/, ".jpeg"), {
    type: 'image/jpeg',
    lastModified: Date.now()
  }) as FileWithOriginalSize;

} else {
  // If the file is already under 5MB, just use it as is.
  console.log(`Skipping compression for ${file.name}, size is already acceptable.`);
  finalFile = fileToProcess as FileWithOriginalSize;
}

finalFile.originalSize = originalSize;
console.log(`Final optimized size: ${(finalFile.size / (1024 * 1024)).toFixed(2)}MB`);

      finalFile.originalSize = originalSize;
      console.log(`Final optimized size: ${(finalFile.size / (1024 * 1024)).toFixed(2)}MB`);

      processedFiles.push(finalFile);

      const previewUrl = URL.createObjectURL(finalFile);
      newPreviews.push(previewUrl);
    }

    setSelectedFiles(prev => [...prev, ...processedFiles]);
    setPreviews(prev => [...prev, ...newPreviews]);
  } catch (error) {
    console.error('Error processing files:', error);
    toast({
      title: "Processing Error",
      description: "An unexpected error occurred while preparing your files.",
      variant: "destructive"
    });
  }
};

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp', '.heic', '.cr2', '.nef', '.arw']
    },
    maxFiles: 20 - selectedFiles.length,
    maxSize: 50 * 1024 * 1024 // 50MB
  });

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreviews(prev => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8 p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl font-bold text-center">Upload Product Images</CardTitle>
          <p className="text-center text-muted-foreground">
            Upload your product photos to get started. Supports PNG, JPG, HEIC, and RAW formats.
          </p>
        </CardHeader>
        <CardContent>
          <div
            {...getRootProps()}
            className={`border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-colors ${
              isDragActive 
                ? 'border-primary bg-primary/5' 
                : 'border-muted-foreground/25 hover:border-primary/50'
            }`}
          >
            <input {...getInputProps()} />
            <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
            {isDragActive ? (
              <p className="text-lg">Drop the files here...</p>
            ) : (
              <>
                <p className="text-lg mb-2">Drag & drop images here, or click to select</p>
                <p className="text-sm text-muted-foreground">
                  Supports: PNG, JPG, WEBP, HEIC, CR2, NEF, ARW • Max 50MB per file • Up to 20 files
                </p>
              </>
            )}
          </div>
        </CardContent>
      </Card>

      {selectedFiles.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Selected Files ({selectedFiles.length}/20)</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
              {selectedFiles.map((file, index) => (
                <div key={index} className="relative border rounded-lg p-4">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeFile(index)}
                    className="absolute top-2 right-2 h-6 w-6 p-0 hover:bg-destructive/10"
                  >
                    <X className="h-4 w-4" />
                  </Button>
                  
                  {previews[index] && (
                    <img 
                      src={previews[index]} 
                      alt={file.name}
                      className="w-full h-32 object-cover rounded mb-2"
                    />
                  )}
                  
                   <div className="space-y-1">
                     <p className="text-sm font-medium truncate">{file.name}</p>
                     <div className="text-xs text-muted-foreground">
                       Original: {((file.originalSize || file.size) / (1024 * 1024)).toFixed(2)}MB
                     </div>
                     <div className="text-xs text-green-600">
                       Optimized: {(file.size / (1024 * 1024)).toFixed(2)}MB
                     </div>
                    <div className="text-xs text-muted-foreground">
                      {file.type}
                    </div>
                  </div>
                </div>
              ))}
            </div>
            
            <div className="flex justify-between items-center">
              <p className="text-sm text-muted-foreground">
                All images are automatically optimized to 2048px max and under 5MB
              </p>
              <Button 
                onClick={() => onFilesUploaded(selectedFiles)}
                disabled={selectedFiles.length === 0}
                className="min-w-[150px]"
              >
                <FileImage className="mr-2 h-4 w-4" />
                Start Processing ({selectedFiles.length})
              </Button>
            </div>
            
            {selectedFiles.length >= 20 && (
              <p className="text-sm text-amber-600 mt-4">
                Maximum of 20 files reached. Remove some files to add more.
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
};