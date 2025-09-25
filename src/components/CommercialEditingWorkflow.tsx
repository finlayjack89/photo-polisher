import React, { useState } from 'react';
import { BackdropPositioning } from './BackdropPositioning';
import { GalleryPreview } from './GalleryPreview';
import { ProcessingStep } from './ProcessingStep';
import { ImageCompressionStep } from './ImageCompressionStep';
import { ImagePreviewStep } from './ImagePreviewStep';
import { BackgroundRemovalStep } from './BackgroundRemovalStep';
import { supabase } from "@/integrations/supabase/client";
import { 
  positionSubjectOnCanvas,
  fileToDataUrl,
  SubjectPlacement
} from "@/lib/canvas-utils";
import { resizeImageFile } from "@/lib/image-resize-utils";
import { useToast } from "@/hooks/use-toast";

interface CommercialEditingWorkflowProps {
  files: File[];
  onBack: () => void;
}

type WorkflowStep = 'analysis' | 'compression' | 'preview' | 'background-removal' | 'positioning' | 'compositing' | 'finalizing' | 'complete';

interface ProcessedImages {
  backgroundRemoved: Array<{ name: string; originalData: string; backgroundRemovedData: string; size: number; }>;
  backdrop?: string;
  placement?: SubjectPlacement;
  addBlur?: boolean;
  composited?: Array<{ name: string; compositedData: string; }>;
  finalized?: Array<{ name: string; finalizedData: string; }>;
}

export const CommercialEditingWorkflow: React.FC<CommercialEditingWorkflowProps> = ({
  files,
  onBack
}) => {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('analysis');
  const [processedImages, setProcessedImages] = useState<ProcessedImages>({ backgroundRemoved: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessingStep, setCurrentProcessingStep] = useState('');
  const [needsCompression, setNeedsCompression] = useState(false);
  const [currentFiles, setCurrentFiles] = useState<File[]>(files);
  const [compressionAnalysis, setCompressionAnalysis] = useState<{
    totalSize: number, 
    largeFiles: number,
    needsResize?: boolean,
    maxDimension?: number
  } | null>(null);
  const { toast } = useToast();

  // Analyze images on component mount
  React.useEffect(() => {
    analyzeImages();
  }, []);

  const analyzeImages = () => {
    const maxDimension = 1024; // Max width/height for Edge Function processing
    const maxFileSize = 5 * 1024 * 1024; // 5MB threshold
    
    let needsProcessing = false;
    let largeFiles = 0;
    
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    // Check if any files are too large in file size
    files.forEach(file => {
      if (file.size > maxFileSize) {
        largeFiles++;
        needsProcessing = true;
      }
    });
    
    // For image files, we also need to check dimensions
    Promise.all(
      files.map(file => {
        if (file.type.startsWith('image/')) {
          return new Promise<boolean>((resolve) => {
            const img = new Image();
            img.onload = () => {
              const needsResize = img.width > maxDimension || img.height > maxDimension;
              resolve(needsResize);
            };
            img.onerror = () => resolve(false);
            img.src = URL.createObjectURL(file);
          });
        }
        return Promise.resolve(false);
      })
    ).then(results => {
      const needsResize = results.some(Boolean);
      if (needsResize || needsProcessing) {
        needsProcessing = true;
      }
      
      setCompressionAnalysis({ 
        totalSize, 
        largeFiles,
        needsResize,
        maxDimension 
      });
      setNeedsCompression(needsProcessing);
      setCurrentStep(needsProcessing ? 'compression' : 'background-removal');
    });
  };

  const handleCompressImages = async () => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Resizing and compressing images...');

    try {
      const maxDimension = 1024; // Max dimension for Edge Function compatibility
      const processedFiles: File[] = [];

      // Process each file
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setProgress((i / files.length) * 50);
        setCurrentProcessingStep(`Processing ${file.name}...`);

        if (file.type.startsWith('image/')) {
          // Check if image needs resizing
          const img = new Image();
          await new Promise((resolve) => {
            img.onload = resolve;
            img.src = URL.createObjectURL(file);
          });

          let processedFile = file;
          
          // Resize if needed
          if (img.naturalWidth > maxDimension || img.naturalHeight > maxDimension) {
            processedFile = await resizeImageFile(file, maxDimension, maxDimension, 0.8);
          }

          processedFiles.push(processedFile);
        } else {
          processedFiles.push(file);
        }
      }

      setProgress(50);
      setCurrentProcessingStep('Applying compression...');

      // Now compress the resized files if they're still large
      const filesNeedingCompression = processedFiles.filter(f => f.size > 2 * 1024 * 1024); // 2MB threshold
      
      if (filesNeedingCompression.length > 0) {
        // Convert to base64 for compression API
        const imageData = await Promise.all(
          filesNeedingCompression.map(async (file) => ({
            data: await fileToDataUrl(file),
            name: file.name,
            size: file.size,
            type: file.type
          }))
        );

        setProgress(70);

        // Compress via Tinify API
        const { data: compressedData, error: compressError } = await supabase.functions.invoke('compress-images', {
          body: {
            files: imageData.map(f => ({
              data: f.data,
              originalName: f.name,
              size: f.size,
              format: f.type.split('/')[1] || 'png'
            }))
          }
        });

        if (compressError || !compressedData?.success) {
          console.warn('Compression failed, using resized files:', compressError?.message);
          setCurrentFiles(processedFiles);
        } else {
          // Convert compressed data back to File objects
          const compressedFiles = await Promise.all(
            compressedData.compressedFiles.map(async (cf: any) => {
              const byteString = atob(cf.data);
              const ab = new ArrayBuffer(byteString.length);
              const ia = new Uint8Array(ab);
              for (let i = 0; i < byteString.length; i++) {
                ia[i] = byteString.charCodeAt(i);
              }
              return new File([ab], cf.originalName, { type: `image/${cf.format}` });
            })
          );

          // Merge compressed files with non-compressed ones
          const finalFiles = [...compressedFiles];
          processedFiles.forEach(file => {
            if (!filesNeedingCompression.some(f => f.name === file.name)) {
              finalFiles.push(file);
            }
          });

          setCurrentFiles(finalFiles);
        }
      } else {
        setCurrentFiles(processedFiles);
      }

      setProgress(100);
      setCurrentProcessingStep('Processing complete!');
      
      toast({
        title: "Images Optimized",
        description: `Successfully processed ${processedFiles.length} images for AI processing`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('background-removal');
      }, 1000);

    } catch (error) {
      console.error('Error processing images:', error);
      toast({
        title: "Processing Error",
        description: "Failed to process images. You can continue with original images.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('background-removal');
    }
  };

  const handleBackgroundRemovalComplete = async (backgroundRemovedImages: Array<{
    name: string;
    originalData: string;
    backgroundRemovedData: string;
    size: number;
  }>) => {
    setProcessedImages({ backgroundRemoved: backgroundRemovedImages });
    setCurrentStep('positioning');
  };

  const handlePositioningComplete = async (backdrop: string, placement: SubjectPlacement, addBlur: boolean) => {
    setProcessedImages(prev => ({ ...prev, backdrop, placement, addBlur }));
    setCurrentStep('compositing');
    await startCompositing(backdrop, placement, addBlur);
  };

  const startCompositing = async (backdrop: string, placement: SubjectPlacement, addBlur: boolean) => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Positioning subjects...');

    try {
      // Update processed images with backdrop and placement data
      setProcessedImages(prev => ({ ...prev, backdrop, placement, addBlur }));

      // Get backdrop dimensions
      const backdropImg = new Image();
      await new Promise((resolve, reject) => {
        backdropImg.onload = resolve;
        backdropImg.onerror = reject;
        backdropImg.src = backdrop;
      });

      // Position all subjects on canvases matching backdrop dimensions
      const positionedSubjects = [];
      for (let i = 0; i < processedImages.backgroundRemoved.length; i++) {
        const subject = processedImages.backgroundRemoved[i];
        setProgress((i / processedImages.backgroundRemoved.length) * 30);
        
        const positionedData = await positionSubjectOnCanvas(
          subject.backgroundRemovedData,
          backdropImg.naturalWidth,
          backdropImg.naturalHeight,
          placement
        );
        
        positionedSubjects.push({
          name: subject.name,
          data: positionedData
        });
      }

      setProgress(40);
      setCurrentProcessingStep('AI compositing with shadows...');

      // Composite images with AI
      const { data: compositeResult, error } = await supabase.functions.invoke('composite-images', {
        body: {
          backdropData: backdrop,
          positionedSubjects,
          addBlur
        }
      });

      if (error) throw error;

      setProgress(80);
      setProcessedImages(prev => ({ ...prev, composited: compositeResult.results }));
      
      setTimeout(() => {
        setCurrentStep('finalizing');
        startFinalization(compositeResult.results, backdrop, placement);
      }, 500);

    } catch (error) {
      console.error('Error in compositing:', error);
      toast({
        title: "Error",
        description: "Failed to composite images. Please try again.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('positioning');
    }
  };

  const startFinalization = async (compositedImages: Array<{ name: string; compositedData: string; }>, backdrop: string, placement: SubjectPlacement) => {
    setCurrentProcessingStep('Final touches and color grading...');
    setProgress(0);

    try {
      console.log('Starting finalization with:', { 
        compositedImagesCount: compositedImages.length,
        hasBackdrop: !!backdrop,
        hasPlacement: !!placement 
      });

      // Validate required data
      if (!backdrop) {
        throw new Error('No backdrop found');
      }
      if (!placement) {
        throw new Error('No placement data found');
      }

      // Use the positioned subjects as guidance images for finalization
      const guidanceImages = [];
      for (let i = 0; i < processedImages.backgroundRemoved.length; i++) {
        const subject = processedImages.backgroundRemoved[i];
        console.log(`Creating guidance image ${i + 1}/${processedImages.backgroundRemoved.length}`);
        
        // Re-create the positioned subject data as guidance for finalization
        const backdropImg = new Image();
        await new Promise((resolve, reject) => {
          backdropImg.onload = resolve;
          backdropImg.onerror = reject;
          backdropImg.src = backdrop;
        });

        console.log('Backdrop loaded, positioning subject...');
        const guidanceData = await positionSubjectOnCanvas(
          subject.backgroundRemovedData,
          backdropImg.naturalWidth,
          backdropImg.naturalHeight,
          placement
        );
        
        guidanceImages.push({
          name: subject.name,
          data: guidanceData
        });
      }

      console.log('Calling finalize-images function...');
      const { data: finalResult, error } = await supabase.functions.invoke('finalize-images', {
        body: {
          compositedImages: compositedImages.map(img => ({
            name: img.name,
            data: img.compositedData
          })),
          guidanceImages
        }
      });

      if (error) {
        console.error('Finalize-images error:', error);
        throw error;
      }

      setProgress(100);
      setProcessedImages(prev => ({ ...prev, finalized: finalResult.results }));
      setCurrentProcessingStep('Complete!');
      
      toast({
        title: "Processing Complete",
        description: `Successfully created ${finalResult.results.length} professional product images`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('complete');
      }, 1000);

    } catch (error) {
      console.error('Error in finalization:', error);
      toast({
        title: "Error",
        description: "Failed to finalize images. Please try again.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('compositing');
    }
  };

  if (currentStep === 'analysis') {
    return null; // Auto-analysis in useEffect
  }

  if (currentStep === 'compression') {
    return (
      <ImageCompressionStep
        files={files}
        compressionAnalysis={compressionAnalysis!}
        onCompress={handleCompressImages}
        onSkip={() => setCurrentStep('preview')}
        isProcessing={isProcessing}
      />
    );
  }

  if (currentStep === 'preview') {
    return (
      <ImagePreviewStep
        files={currentFiles}
        onContinue={() => setCurrentStep('background-removal')}
        wasCompressed={needsCompression && currentFiles !== files}
      />
    );
  }

  if (currentStep === 'background-removal') {
    return (
      <BackgroundRemovalStep
        files={currentFiles}
        onContinue={handleBackgroundRemovalComplete}
        onBack={() => setCurrentStep('preview')}
      />
    );
  }


  if (currentStep === 'positioning') {
    return (
      <BackdropPositioning
        cutoutImages={processedImages.backgroundRemoved.map(subject => subject.backgroundRemovedData)}
        onPositioningComplete={handlePositioningComplete}
        onBack={() => setCurrentStep('background-removal')}
      />
    );
  }

  if ((currentStep === 'compositing' || currentStep === 'finalizing') && isProcessing) {
    return (
      <ProcessingStep
        title={currentStep === 'compositing' ? "AI Compositing" : "Final Processing"}
        description={currentStep === 'compositing' ? "Adding shadows and effects..." : "Applying final touches..."}
        progress={progress}
        currentStep={currentProcessingStep}
        files={currentFiles}
      />
    );
  }

  if (currentStep === 'complete' && processedImages.finalized) {
    // Prepare processed images data for GalleryPreview
    const galleryImages = processedImages.finalized.map((result, index) => ({
      name: result.name,
      originalData: files[index] ? URL.createObjectURL(files[index]) : '',
      processedData: result.finalizedData,
      size: result.finalizedData.length * 0.75 // Rough estimate of base64 to bytes
    }));

    return (
      <GalleryPreview
        processedImages={galleryImages}
        onBack={onBack}
        onRetry={() => setCurrentStep('compression')}
      />
    );
  }

  return null;
};