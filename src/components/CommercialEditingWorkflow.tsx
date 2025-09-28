import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
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
  files: (File & { isPreCut?: boolean })[];
  onBack: () => void;
}

type WorkflowStep = 'analysis' | 'compression' | 'preview' | 'background-removal' | 'positioning' | 'client-compositing' | 'processing' | 'preview-results' | 'ai-enhancement' | 'complete' | 'precut-enhancement';

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
  const [currentFiles, setCurrentFiles] = useState<(File & { isPreCut?: boolean })[]>(files);
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
    // Check if all images are pre-cut (transparent backgrounds already removed)
    const allPreCut = files.every(file => file.isPreCut);
    const hasPreCut = files.some(file => file.isPreCut);

    if (allPreCut) {
      console.log('All images are pre-cut, skipping to AI enhancement workflow');
      setCurrentStep('precut-enhancement');
      return;
    }

    if (hasPreCut) {
      console.log('Mixed pre-cut and regular images detected');
      // Handle mixed workflow - will need to process differently
    }

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
            
            // Debug: Verify we're using the transparent subject
            console.log(`Compositing ${image.name}:`, {
              hasBackdrop: !!data.result.backdropData,
              hasShadow: !!data.result.shadowLayerData,
              hasSubject: !!image.backgroundRemovedData,
              subjectDataLength: image.backgroundRemovedData?.length,
              subjectPreview: image.backgroundRemovedData?.substring(0, 100)
            });
            
            // Ensure we're using only the transparent subject (never the original image)
            let transparentSubjectData = image.backgroundRemovedData;
            
            // Verify this is actually transparent PNG data
            if (!transparentSubjectData?.includes('data:image/png')) {
              console.error(`Invalid subject data for ${image.name} - not PNG format`);
              throw new Error(`Subject image for ${image.name} is not in PNG format with transparency`);
            }
            
            console.log(`Using transparent subject data for ${image.name} (length: ${transparentSubjectData.length})`);
            
            const finalImageUrl = await compositeLayers(
              data.result.backdropData,
              data.result.shadowLayerData,
              transparentSubjectData, // Guaranteed transparent PNG from background removal
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

  // AI Enhancement for pre-cut images (skip background removal and positioning)
  const startPreCutEnhancement = async () => {
    setCurrentStep('precut-enhancement');
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Enhancing pre-cut images with AI...');

    try {
      // Convert files to data URLs for processing
      const imageData = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setCurrentProcessingStep(`Processing ${file.name} (${i + 1}/${files.length})...`);
        
        const dataUrl = await fileToDataUrl(file);
        imageData.push({
          name: file.name,
          data: dataUrl
        });
        
        setProgress((i / files.length) * 50);
      }

      setCurrentProcessingStep('Applying AI enhancement...');
      setProgress(50);

      // Use the retry-single-image-enhancement function for better quality
      const enhancedResults = [];
      for (let i = 0; i < imageData.length; i++) {
        const image = imageData[i];
        setCurrentProcessingStep(`Enhancing ${image.name} (${i + 1}/${imageData.length})...`);
        
        try {
          const { data, error } = await supabase.functions.invoke('retry-single-image-enhancement', {
            body: {
              compositedImageData: image.data,
              temperature: 0.3, // Lower temperature for more consistent results
              imageName: image.name
            }
          });

          if (error || !data?.success) {
            console.error(`Enhancement failed for ${image.name}:`, error);
            // Fall back to original image if enhancement fails
            enhancedResults.push({
              name: image.name,
              enhancedData: image.data
            });
          } else {
            enhancedResults.push({
              name: image.name,
              enhancedData: data.enhancedImageData
            });
          }
        } catch (enhanceError) {
          console.error(`Enhancement error for ${image.name}:`, enhanceError);
          // Fall back to original image
          enhancedResults.push({
            name: image.name,
            enhancedData: image.data
          });
        }
        
        setProgress(50 + ((i + 1) / imageData.length) * 50);
      }

      setProcessedImages(prev => ({
        ...prev,
        aiEnhanced: enhancedResults // Keep original structure with enhancedData
      }));

      setProgress(100);
      setCurrentProcessingStep('Enhancement complete!');
      
      toast({
        title: "AI Enhancement Complete",
        description: `Successfully enhanced ${enhancedResults.length} pre-cut images!`
      });

      setTimeout(() => {
        setIsProcessing(false);
        setCurrentStep('complete');
      }, 1500);

    } catch (error) {
      console.error('Error in pre-cut enhancement:', error);
      toast({
        title: "Enhancement Error",
        description: "Failed to enhance images. Please try again.",
        variant: "destructive"
      });
      setIsProcessing(false);
      setCurrentStep('precut-enhancement');
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

  if (currentStep === 'precut-enhancement') {
    return (
      <div className="max-w-4xl mx-auto space-y-8 p-6">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold">AI Enhancement</h2>
          <p className="text-muted-foreground">
            Enhancing your pre-cut images with professional AI touches
          </p>
        </div>
        
        {!isProcessing ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
              {files.map((file, index) => (
                <div key={index} className="relative border rounded-lg p-2">
                  <img 
                    src={URL.createObjectURL(file)} 
                    alt={file.name}
                    className="w-full h-32 object-cover rounded"
                  />
                  <p className="text-sm font-medium truncate mt-2">{file.name}</p>
                  <p className="text-xs text-electric">Pre-cut image</p>
                </div>
              ))}
            </div>
            
            <div className="flex justify-center space-x-4">
              <Button variant="outline" onClick={onBack}>
                Back to Upload
              </Button>
              <Button onClick={startPreCutEnhancement}>
                Start AI Enhancement
              </Button>
            </div>
          </div>
        ) : (
          <ProcessingStep
            title="AI Enhancement"
            description="Enhancing your pre-cut images with professional AI touches"
            currentStep={currentProcessingStep}
            progress={progress}
            files={files}
          />
        )}
      </div>
    );
  }

  if (currentStep === 'complete') {
    // Convert enhanced results to the format expected by GalleryPreview
    const finalResults = processedImages.aiEnhanced?.map(result => ({
      name: result.name,
      finalizedData: result.enhancedData // Convert enhancedData to finalizedData for display
    })) || processedImages.finalResults || processedImages.clientComposited?.map(result => ({
      name: result.name,
      finalizedData: result.compositedData
    }));
    
    return (
      <GalleryPreview
        results={finalResults || []}
        onBack={onBack}
        title="Enhancement Complete!"
      />
    );
  }

  return null;
};