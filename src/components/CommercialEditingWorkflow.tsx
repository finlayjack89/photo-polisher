import React, { useState } from 'react';
import { ProductConfiguration, ProductConfig } from './ProductConfiguration';
import { BackdropPositioning } from './BackdropPositioning';
import { GalleryPreview } from './GalleryPreview';
import { ProcessingStep } from './ProcessingStep';
import { ImageCompressionStep } from './ImageCompressionStep';
import { ImagePreviewStep } from './ImagePreviewStep';
import { supabase } from "@/integrations/supabase/client";
import { 
  convertBlackToTransparent, 
  applyMaskToImage, 
  positionSubjectOnCanvas,
  fileToDataUrl,
  SubjectPlacement
} from "@/lib/canvas-utils";
import { useToast } from "@/hooks/use-toast";

interface CommercialEditingWorkflowProps {
  files: File[];
  onBack: () => void;
}

type WorkflowStep = 'analysis' | 'compression' | 'preview' | 'config' | 'processing' | 'positioning' | 'compositing' | 'finalizing' | 'complete';

interface ProcessedImages {
  masks: Array<{ name: string; originalData: string; maskData: string; correctedMaskData: string; cutoutData: string; }>;
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
  const [productConfig, setProductConfig] = useState<ProductConfig | null>(null);
  const [processedImages, setProcessedImages] = useState<ProcessedImages>({ masks: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessingStep, setCurrentProcessingStep] = useState('');
  const [needsCompression, setNeedsCompression] = useState(false);
  const [currentFiles, setCurrentFiles] = useState<File[]>(files);
  const [compressionAnalysis, setCompressionAnalysis] = useState<{totalSize: number, largeFiles: number} | null>(null);
  const { toast } = useToast();

  // Analyze images on component mount
  React.useEffect(() => {
    analyzeImages();
  }, []);

  const analyzeImages = () => {
    const maxFileSize = 50 * 1024 * 1024; // 50MB threshold for compression
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const largeFiles = files.filter(file => file.size > maxFileSize).length;
    
    setCompressionAnalysis({ totalSize, largeFiles });
    
    if (largeFiles > 0 || totalSize > 200 * 1024 * 1024) { // 200MB total threshold
      setNeedsCompression(true);
      setCurrentStep('compression');
    } else {
      setCurrentStep('preview');
    }
  };

  const handleCompressImages = async () => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Compressing images...');

    try {
      // Convert files to base64
      const imageData = await Promise.all(
        files.map(async (file) => ({
          data: await fileToDataUrl(file),
          name: file.name,
          size: file.size,
          type: file.type
        }))
      );

      setProgress(20);

      // Compress images
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
        throw new Error(`Compression failed: ${compressError?.message || 'Unknown compression error'}`);
      }

      setProgress(100);

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

      setCurrentFiles(compressedFiles);
      setCurrentProcessingStep('Compression complete!');
      
      toast({
        title: "Images Compressed",
        description: `Successfully compressed ${compressedFiles.length} images`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('preview');
      }, 1000);

    } catch (error) {
      console.error('Error compressing images:', error);
      toast({
        title: "Compression Error",
        description: "Failed to compress images. You can continue with original images.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('preview');
    }
  };

  const handleConfigurationComplete = async (config: ProductConfig) => {
    setProductConfig(config);
    setCurrentStep('processing');
    await startMaskGeneration(config);
  };

  const startMaskGeneration = async (config: ProductConfig) => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Compressing images...');

    try {
      // Convert files to base64
      const imageData = await Promise.all(
        files.map(async (file) => ({
          data: await fileToDataUrl(file),
          name: file.name,
          size: file.size,
          type: file.type
        }))
      );

      setProgress(10);

      // Compress images to stay under Edge Function 256MB memory limit
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
        throw new Error(`Compression failed: ${compressError?.message || 'Unknown compression error'}`);
      }

      setProgress(20);
      setCurrentProcessingStep('Generating AI masks...');
      
      // Generate masks using AI
      const { data: maskResult, error } = await supabase.functions.invoke('generate-masks', {
        body: {
          images: imageData,
          productType: config.productType,
          features: config.features
        }
      });

      if (error) throw error;

      setProgress(40);
      setCurrentProcessingStep('Correcting masks...');

      // Correct masks and apply to images
      const correctedMasks = [];
      for (let i = 0; i < maskResult.results.length; i++) {
        const result = maskResult.results[i];
        
        // Step 3: Correct the mask
        const correctedMaskData = await convertBlackToTransparent(result.maskData);
        
        setProgress(40 + (i / maskResult.results.length) * 30);
        
        // Step 4: Apply mask to remove background
        const cutoutData = await applyMaskToImage(result.originalData, correctedMaskData);
        
        correctedMasks.push({
          name: result.name,
          originalData: result.originalData,
          maskData: result.maskData,
          correctedMaskData,
          cutoutData
        });
      }

      setProcessedImages({ masks: correctedMasks });
      setProgress(100);
      setCurrentProcessingStep('Complete!');
      
      toast({
        title: "Masks Generated",
        description: `Successfully processed ${correctedMasks.length} images`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('positioning');
      }, 1000);

    } catch (error) {
      console.error('Error in mask generation:', error);
      toast({
        title: "Error",
        description: "Failed to generate masks. Please try again.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('config');
    }
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
      // Get backdrop dimensions
      const backdropImg = new Image();
      await new Promise((resolve) => {
        backdropImg.onload = resolve;
        backdropImg.src = backdrop;
      });

      // Position all subjects on canvases matching backdrop dimensions
      const positionedSubjects = [];
      for (let i = 0; i < processedImages.masks.length; i++) {
        const mask = processedImages.masks[i];
        setProgress((i / processedImages.masks.length) * 30);
        
        const positionedData = await positionSubjectOnCanvas(
          mask.cutoutData,
          backdropImg.naturalWidth,
          backdropImg.naturalHeight,
          placement
        );
        
        positionedSubjects.push({
          name: mask.name,
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
        startFinalization(compositeResult.results);
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

  const startFinalization = async (compositedImages: Array<{ name: string; compositedData: string; }>) => {
    setCurrentProcessingStep('Final touches and color grading...');
    setProgress(0);

    try {
      const originalMasks = processedImages.masks.map(mask => ({
        name: mask.name,
        data: mask.correctedMaskData
      }));

      const { data: finalResult, error } = await supabase.functions.invoke('finalize-images', {
        body: {
          compositedImages: compositedImages,
          originalMasks
        }
      });

      if (error) throw error;

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
        onContinue={() => setCurrentStep('config')}
        wasCompressed={needsCompression && currentFiles !== files}
      />
    );
  }

  if (currentStep === 'analysis') {
    return null; // Auto-analysis in useEffect
  }

  if (currentStep === 'config') {
    return (
      <ProductConfiguration
        files={currentFiles}
        onConfigurationComplete={handleConfigurationComplete}
        onBack={() => setCurrentStep('preview')}
      />
    );
  }

  if (currentStep === 'processing' && isProcessing) {
    return (
      <ProcessingStep
        title="AI Mask Generation"
        description="Creating precision masks for your products..."
        progress={progress}
        currentStep={currentProcessingStep}
        files={currentFiles}
      />
    );
  }

  if (currentStep === 'positioning') {
    return (
      <BackdropPositioning
        cutoutImages={processedImages.masks.map(mask => mask.cutoutData)}
        onPositioningComplete={handlePositioningComplete}
        onBack={() => setCurrentStep('config')}
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
    // Convert processed results to File objects for GalleryPreview
    const processedFiles = processedImages.finalized.map((result, index) => {
      const byteString = atob(result.finalizedData.split(',')[1]);
      const ab = new ArrayBuffer(byteString.length);
      const ia = new Uint8Array(ab);
      for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
      }
      return new File([ab], `processed_${result.name}`, { type: 'image/jpeg' });
    });

    return (
      <GalleryPreview
        files={processedFiles}
        onBack={onBack}
      />
    );
  }

  return null;
};