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

  const analyzeImages = () => {
    const maxDimension = 1024; // Max width/height for Edge Function processing
    const maxFileSize = 5 * 1024 * 1024; // 5MB threshold for compression advisory
    
    
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

  const handlePositioningComplete = (backdrop: string, placement: SubjectPlacement, addBlur: boolean) => {
    console.log('Positioning completed, starting V5 single-image processing...');
    setProcessedImages(prev => ({ ...prev, backdrop, placement, addBlur }));
    startV5SingleImageProcessing();
  };

  // V5 Single-Image Processing with Real-Time Progress
  const startV5SingleImageProcessing = async () => {
    if (!processedImages.backgroundRemoved?.length || !processedImages.backdrop || !processedImages.placement) {
      console.error('Missing required data for V5 processing');
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
            results.push({
              name: data.result.name,
              finalizedData: data.result.finalizedData
            });
            
            console.log(`✓ Successfully processed ${image.name} with V5 architecture`);
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
        onBack={() => setCurrentStep('compression')}
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

  if (currentStep === 'preview-results' && processedImages.clientComposited) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold mb-4">Your Images Are Ready!</h2>
        <p className="text-muted-foreground mb-6">
          Your images have been composed successfully. You can download them now or enhance them further with AI.
        </p>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
          {processedImages.clientComposited.map((result, index) => (
            <div key={index} className="border rounded-lg p-4">
              <h3 className="font-semibold mb-2">{result.name}</h3>
              <img 
                src={result.compositedData} 
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

  if (currentStep === 'complete' && (processedImages.aiEnhanced || processedImages.clientComposited)) {
    const finalImages = processedImages.aiEnhanced || processedImages.clientComposited;
    return (
      <GalleryPreview
        results={finalImages.map((result, index) => ({
          name: result.name,
          originalData: files[index] ? URL.createObjectURL(files[index]) : '',
          finalizedData: processedImages.aiEnhanced 
            ? (result as any).enhancedData 
            : (result as any).compositedData,
          size: ((processedImages.aiEnhanced 
            ? (result as any).enhancedData 
            : (result as any).compositedData) || '').length * 0.75
        }))}
        onBack={onBack}
        title="Final Enhanced Images"
      />
    );
  }

  return null;
};