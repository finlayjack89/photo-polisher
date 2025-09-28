import React, { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { Button } from '@/components/ui/button';
import { processAndCompressImage, getImageDimensions } from '@/lib/image-resize-utils';
import { useToast } from "@/components/ui/use-toast";
import heic2any from "heic2any";

export interface FileWithOriginalSize extends File {
  originalSize?: number;
}

interface UploadZoneProps {
  selectedFiles: FileWithOriginalSize[];
  setSelectedFiles: React.Dispatch<React.SetStateAction<FileWithOriginalSize[]>>;
  previews: string[];
  setPreviews: React.Dispatch<React.SetStateAction<string[]>>;
}

const UploadZone: React.FC<UploadZoneProps> = ({
  selectedFiles,
  setSelectedFiles,
  previews,
  setPreviews,
}) => {
  const { toast } = useToast();

  const onDrop = useCallback(async (acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => {
      const isValidType = file.type.startsWith('image/') || file.name.toLowerCase().endsWith('.heic');
      const isValidSize = file.size <= 50 * 1024 * 1024; // 50MB limit
      if (!isValidType) console.warn(`Invalid file type: ${file.name}`);
      if (!isValidSize) console.warn(`File too large: ${file.name}`);
      return isValidType && isValidSize;
    });

    if (validFiles.length + selectedFiles.length > 20) {
      toast({
        title: "Upload Limit Exceeded",
        description: "You can upload a maximum of 20 images per batch.",
        variant: "destructive",
      });
      return;
    }

    const newFilesToProcess: FileWithOriginalSize[] = [];
    const newPreviews: string[] = [];

    for (const file of validFiles) {
      try {
        let fileToProcess: File | Blob = file;
        const originalSize = file.size;

        if (file.name.toLowerCase().endsWith('.heic')) {
          console.log(`Converting HEIC file: ${file.name}`);
          fileToProcess = await heic2any({ blob: file, toType: "image/png" });
        }

        const dimensions = await getImageDimensions(fileToProcess);
        const FIVE_MB = 5 * 1024 * 1024;
        const needsProcessing = originalSize > FIVE_MB || dimensions.width > 2048 || dimensions.height > 2048;

        let finalFile: FileWithOriginalSize;

        if (needsProcessing) {
          console.log(`Processing needed for ${file.name}.`);
          const compressedBlob = await processAndCompressImage(fileToProcess as File);
          finalFile = new File([compressedBlob], file.name.replace(/\.[^/.]+$/, ".jpeg"), {
            type: 'image/jpeg',
            lastModified: Date.now(),
          }) as FileWithOriginalSize;
        } else {
          console.log(`Skipping processing for ${file.name}, already compliant.`);
          finalFile = fileToProcess as FileWithOriginalSize;
        }
        
        finalFile.originalSize = originalSize;
        newFilesToProcess.push(finalFile);
        
        const previewUrl = URL.createObjectURL(finalFile);
        newPreviews.push(previewUrl);

      } catch (error) {
        console.error(`Error processing file ${file.name}:`, error);
        toast({
          title: "Processing Error",
          description: `Could not process ${file.name}. It may be corrupt or an unsupported format.`,
          variant: "destructive",
        });
      }
    }

    setSelectedFiles(prev => [...prev, ...newFilesToProcess]);
    setPreviews(prev => [...prev, ...newPreviews]);
  }, [selectedFiles, setSelectedFiles, setPreviews, toast]);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.jpeg', '.jpg', '.png', '.webp', '.heic'] },
    multiple: true,
  });

  useEffect(() => {
    return () => previews.forEach(URL.revokeObjectURL);
  }, [previews]);

  return (
    <div {...getRootProps()} className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center cursor-pointer hover:border-gray-400 transition-colors">
      <input {...getInputProps()} />
      {isDragActive ? (
        <p>Drop the files here ...</p>
      ) : (
        <p>Drag 'n' drop some files here, or click to select files</p>
      )}
      <Button type="button" variant="outline" className="mt-4">
        Select Images
      </Button>
      <p className="text-xs text-gray-500 mt-2">Up to 20 images, 50MB each</p>
    </div>
  );
};

export default UploadZone;