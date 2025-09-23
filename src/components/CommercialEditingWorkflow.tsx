import React, { useState } from 'react';
import { ProductConfiguration, ProductConfig } from './ProductConfiguration';
import { BackdropPositioning } from './BackdropPositioning';
import { GalleryPreview } from './GalleryPreview';
import { ProcessingStep } from './ProcessingStep';
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

type WorkflowStep = 'config' | 'processing' | 'positioning' | 'compositing' | 'finalizing' | 'complete';

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
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('config');
  const [productConfig, setProductConfig] = useState<ProductConfig | null>(null);
  const [processedImages, setProcessedImages] = useState<ProcessedImages>({ masks: [] });
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessingStep, setCurrentProcessingStep] = useState('');
  const { toast } = useToast();

  const handleConfigurationComplete = async (config: ProductConfig) => {
    setProductConfig(config);
    setCurrentStep('processing');
    await startMaskGeneration(config);
  };

  const startMaskGeneration = async (config: ProductConfig) => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Generating AI masks...');

    try {
      // Convert files to base64
      const imageData = await Promise.all(
        files.map(async (file) => ({
          data: await fileToDataUrl(file),
          name: file.name
        }))
      );

      setProgress(20);
      
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

  if (currentStep === 'config') {
    return (
      <ProductConfiguration
        files={files}
        onConfigurationComplete={handleConfigurationComplete}
        onBack={onBack}
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
        files={files}
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
        files={files}
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