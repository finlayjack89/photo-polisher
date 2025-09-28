import React, { useState } from 'react';
import { BackdropPositioning } from './BackdropPositioning';
import { GalleryPreview } from './GalleryPreview';
import { ProcessingStep } from './ProcessingStep';
import { ImagePreviewStep } from './ImagePreviewStep';
import { BackgroundRemovalStep } from './BackgroundRemovalStep';
import { supabase } from "@/integrations/supabase/client";
import { 
  positionSubjectOnCanvas,
  fileToDataUrl,
  SubjectPlacement,
  compositeLayers
} from "@/lib/canvas-utils";
// Removed resizeImageFile import - now using processAndCompressImage in UploadZone
import { useToast } from "@/hooks/use-toast";

interface CommercialEditingWorkflowProps {
  files: File[];
  onBack: () => void;
}

type WorkflowStep = 'analysis' | 'compression' | 'preview' | 'background-removal' | 'positioning' | 'client-compositing' | 'processing' | 'preview-results' | 'ai-enhancement' | 'complete';

interface ProcessedImages {
  backgroundRemoved: Array<{ name: string; originalData: string; backgroundRemovedData: string; size: number; }>;
  backdrop?: string;
  placement?: SubjectPlacement;
  addBlur?: boolean;
  clientComposited?: Array<{ name: string; compositedData: string; }>;
  aiEnhanced?: Array<{ name: string; enhancedData: string; }>;
  finalResults?: Array<{ name: string; finalizedData: string; }>;
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

  // Auto-start processing when we have all required data
  React.useEffect(() => {
    if (currentStep === 'processing' && processedImages.backdrop && processedImages.placement && processedImages.backgroundRemoved.length > 0) {
      startV5SingleImageProcessing();
    }
  }, [currentStep, processedImages.backdrop, processedImages.placement, processedImages.backgroundRemoved.length]);

  const analyzeImages = () => {
    // Images are now pre-processed during upload to be 2048px max and under 5MB
    // Skip compression step and go directly to background removal
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    
    setCompressionAnalysis({ 
      totalSize, 
      largeFiles: 0,  // All files are already optimized
      needsResize: false,
      maxDimension: 2048 
    });
    setNeedsCompression(false);
    setCurrentStep('background-removal');
  };

  // Compression step is no longer needed - images are pre-processed during upload
  // This function is kept for backwards compatibility but should not be called
  const handleCompressImages = async () => {
    console.log('Compression step bypassed - images already processed during upload');
    setCurrentFiles(files);
    setCurrentStep('background-removal');
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

  const handlePositioningComplete = (backdrop: string, placement: SubjectPlacement, addBlur: boolean) => {
    console.log('Positioning completed, starting V5 single-image processing...');
    setProcessedImages(prev => ({ ...prev, backdrop, placement, addBlur }));
    setCurrentStep('processing');
  };

  // V5 Single-Image Processing with Real-Time Progress
  const startV5SingleImageProcessing = async () => {
    if (!processedImages.backgroundRemoved?.length || !processedImages.backdrop || !processedImages.placement) {
      console.error('Missing required data for V5 processing');
      toast({
        title: "Processing Error", 
        description: "Missing required data for processing. Please try again.",
        variant: "destructive"
      });
      return;
    }

    setCurrentStep('processing');
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Starting V5 single-image processing...');

    const results: Array<{ name: string; finalizedData: string }> = [];
    const totalImages = processedImages.backgroundRemoved.length;

    try {
      // Process each image individually with real-time progress
      for (let i = 0; i < processedImages.backgroundRemoved.length; i++) {
        const image = processedImages.backgroundRemoved[i];
        
        setCurrentProcessingStep(`Processing ${image.name} (${i + 1}/${totalImages})...`);
        setProgress((i / totalImages) * 100);

        console.log(`V5 Processing image ${i + 1}/${totalImages}: ${image.name}`);

        try {
          const { data, error } = await supabase.functions.invoke('v5-process-single-image', {
            body: {
              imageData: image.backgroundRemovedData,
              imageName: image.name,
              backdrop: processedImages.backdrop,
              placement: processedImages.placement,
              addBlur: processedImages.addBlur || false
            }
          });

          if (error) {
            console.error(`V5 processing failed for ${image.name}:`, error);
            throw new Error(`Processing failed for ${image.name}: ${error.message}`);
          }

          if (data?.success && data.result) {
            // Composite the layers on the frontend for maximum quality
            setCurrentProcessingStep(`Compositing ${image.name} with high quality...`);
            
            const finalImageUrl = await compositeLayers(
              data.result.backdropData,
              data.result.shadowLayerData,
              image.backgroundRemovedData, // Use the original background-removed transparent PNG
              processedImages.placement
            );
            
            results.push({
              name: data.result.name,
              finalizedData: finalImageUrl
            });
            
            console.log(`✓ Successfully processed and composited ${image.name} with V5 architecture`);
            setCurrentProcessingStep(`✓ Completed ${image.name} (${i + 1}/${totalImages})`);
          } else {
            throw new Error(`Invalid response for ${image.name}`);
          }

        } catch (imageError) {
          console.error(`Failed to process ${image.name}:`, imageError);
          // Continue with other images instead of failing entirely
          setCurrentProcessingStep(`⚠ Failed to process ${image.name}, continuing with others...`);
        }

        // Update progress after each image
        setProgress(((i + 1) / totalImages) * 100);
      }

      // Update with final results
      setProcessedImages(prev => ({
        ...prev,
        finalResults: results
      }));
      
      setProgress(100);
      setCurrentProcessingStep(`✓ V5 Processing complete! ${results.length}/${totalImages} images processed successfully.`);
      
      console.log(`V5 Processing completed: ${results.length}/${totalImages} images successful`);
      
      // Move to preview step
      setTimeout(() => {
        setCurrentStep('preview-results');
        setIsProcessing(false);
      }, 1500);

    } catch (error) {
      console.error('V5 processing workflow failed:', error);
      toast({
        title: "Processing Failed",
        description: error instanceof Error ? error.message : 'Unknown error occurred during processing',
        variant: "destructive"
      });
      setCurrentProcessingStep(`❌ Processing failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
      setProgress(0);
      setIsProcessing(false);
    }
  };

  const startClientCompositing = async (backdrop: string, placement: SubjectPlacement, addBlur: boolean) => {
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Creating client-side composition...');

    try {
      // Get backdrop image
      const backdropImg = new Image();
      await new Promise((resolve, reject) => {
        backdropImg.onload = resolve;
        backdropImg.onerror = reject;
        backdropImg.src = backdrop;
      });

      setProgress(20);
      setCurrentProcessingStep('Positioning subjects on backdrop...');

      const clientComposited = [];

      // Process each background-removed image
      for (let i = 0; i < processedImages.backgroundRemoved.length; i++) {
        const subject = processedImages.backgroundRemoved[i];
        setProgress(20 + (i / processedImages.backgroundRemoved.length) * 60);
        setCurrentProcessingStep(`Compositing ${subject.name}...`);

        // Position subject on backdrop using client-side canvas
        const compositedData = await positionSubjectOnCanvas(
          subject.backgroundRemovedData,
          backdropImg.naturalWidth,
          backdropImg.naturalHeight,
          placement
        );

        // Create final composite by drawing backdrop + positioned subject
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = backdropImg.naturalWidth;
        finalCanvas.height = backdropImg.naturalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        
        if (!finalCtx) throw new Error('Could not get canvas context');

        // Draw backdrop
        finalCtx.drawImage(backdropImg, 0, 0);

        // Draw positioned subject on top
        const subjectImg = new Image();
        await new Promise((resolve, reject) => {
          subjectImg.onload = resolve;
          subjectImg.onerror = reject;
          subjectImg.src = compositedData;
        });

        finalCtx.drawImage(subjectImg, 0, 0);

        // Apply blur if requested
        if (addBlur) {
          finalCtx.filter = 'blur(1px)';
          finalCtx.drawImage(backdropImg, 0, 0);
          finalCtx.filter = 'none';
          finalCtx.drawImage(subjectImg, 0, 0);
        }

        clientComposited.push({
          name: subject.name,
          compositedData: finalCanvas.toDataURL('image/png')
        });
      }

      setProgress(100);
      setCurrentProcessingStep('Client-side composition complete!');

      // Update state with client-composited results
      setProcessedImages(prev => ({
        ...prev,
        clientComposited
      }));

      toast({
        title: "Images Composed",
        description: `Successfully created ${clientComposited.length} product images instantly!`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('preview-results');
      }, 1000);

    } catch (error) {
      console.error('Error in client-side compositing:', error);
      toast({
        title: "Composition Error",
        description: "Failed to create composition. Please try again.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('positioning');
    }
  };

  const startAIEnhancement = async () => {
    if (!processedImages.clientComposited) return;

    setIsProcessing(true);
    setProgress(0);
    setCurrentStep('ai-enhancement');
    setCurrentProcessingStep('Enhancing images with AI...');

    try {
      const { data: result, error } = await supabase.functions.invoke('finalize-image-v3', {
        body: {
          images: processedImages.clientComposited.map(img => ({
            name: img.name,
            data: img.compositedData
          }))
        }
      });

      if (error || !result?.success) {
        throw new Error(error?.message || 'AI enhancement failed');
      }

      setProgress(100);
      setProcessedImages(prev => ({
        ...prev,
        aiEnhanced: result.results
      }));

      toast({
        title: "AI Enhancement Complete",
        description: `Successfully enhanced ${result.results.length} images with professional touches!`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('complete');
      }, 1000);

    } catch (error) {
      console.error('Error in AI enhancement:', error);
      toast({
        title: "Enhancement Error",
        description: "AI enhancement failed, but you still have the composed images.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('preview-results');
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
      setCurrentStep('preview-results');
    }
  };

  if (currentStep === 'analysis') {
    return null; // Auto-analysis in useEffect
  }

  if (currentStep === 'preview') {
    return (
      <ImagePreviewStep
        files={currentFiles}
        onContinue={() => setCurrentStep('background-removal')}
        onBack={onBack}
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

  if (currentStep === 'processing') {
    return (
      <ProcessingStep
        title="Processing Images"
        description="Creating your professional product images..."
        progress={progress}
        currentStep={currentProcessingStep}
        files={currentFiles}
      />
    );
  }

  if ((currentStep === 'client-compositing' || currentStep === 'ai-enhancement') && isProcessing) {
    return (
      <ProcessingStep
        title={currentStep === 'client-compositing' ? "Creating Composition" : "AI Enhancement"}
        description={currentStep === 'client-compositing' ? "Combining images instantly..." : "Adding professional polish..."}
        progress={progress}
        currentStep={currentProcessingStep}
        files={currentFiles}
      />
    );
  }

  if (currentStep === 'preview-results' && processedImages.finalResults) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Your Images Are Ready!</h2>
        <p className="text-muted-foreground mb-6">
          Your images have been processed successfully. You can download them now or enhance them further with AI.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {processedImages.finalResults.map((result, index) => (
            <div key={index} className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">{result.name}</h3>
              <img 
                src={result.finalizedData} 
                alt={result.name}
                className="w-full h-48 object-contain bg-gray-50 rounded"
              />
            </div>
          ))}
        </div>

        <div className="flex gap-4 justify-center">
          <button
            onClick={() => setCurrentStep('complete')}
            className="px-6 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
          >
            Download Images
          </button>
          <button
            onClick={startAIEnhancement}
            disabled={isProcessing}
            className="px-6 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 disabled:opacity-50"
          >
            Enhance with AI
          </button>
          <button
            onClick={() => setCurrentStep('positioning')}
            className="px-6 py-2 border rounded-lg hover:bg-gray-50"
          >
            Try Different Position
          </button>
        </div>
      </div>
    );
  }

  if (currentStep === 'complete' && (processedImages.aiEnhanced || processedImages.finalResults)) {
    const finalImages = processedImages.aiEnhanced || processedImages.finalResults;
    return (
      <GalleryPreview
        results={finalImages.map((result, index) => ({
          name: result.name,
          originalData: files[index] ? URL.createObjectURL(files[index]) : '',
          finalizedData: processedImages.aiEnhanced 
            ? (result as any).enhancedData 
            : result.finalizedData,
          size: ((processedImages.aiEnhanced 
            ? (result as any).enhancedData 
            : result.finalizedData) || '').length * 0.75
        }))}
        onBack={onBack}
        title="Final Enhanced Images"
      />
    );
  }

  return null;
};