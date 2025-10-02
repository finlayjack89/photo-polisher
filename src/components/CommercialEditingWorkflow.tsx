import React, { useState } from 'react';
import { BackdropPositioning } from './BackdropPositioning';
import { GalleryPreview } from './GalleryPreview';
import { ProcessingStep } from './ProcessingStep';
import { ImagePreviewStep } from './ImagePreviewStep';
import { BackgroundRemovalStep } from './BackgroundRemovalStep';
import { ImageRotationStep } from './ImageRotationStep';
import { uploadToCloudinary, renderComposite, MARBLE_STUDIO_GLOSS_V1 } from '@/lib/cloudinary-render';
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface CommercialEditingWorkflowProps {
  files: (File & { isPreCut?: boolean })[];
  onBack: () => void;
}

type WorkflowStep = 'analysis' | 'preview' | 'background-removal' | 'rotation' | 'positioning' | 'cloudinary-rendering' | 'complete' | 'precut-rotation';

interface ProcessedSubject {
  name: string;
  originalFilename: string;
  imageUrl: string;
  backgroundRemovedData?: string;
  size?: number;
}

interface ProcessedImages {
  backgroundRemoved: Array<{ name: string; originalData: string; backgroundRemovedData: string; size: number; }>;
  backdrop?: string;
  backdropCloudinaryId?: string;
  placement?: {
    x: number;
    y: number;
    scale: number;
  };
  addBlur?: boolean;
  finalResults?: Array<{ name: string; finalizedData: string; }>;
}

export const CommercialEditingWorkflow: React.FC<CommercialEditingWorkflowProps> = ({
  files,
  onBack
}) => {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>('analysis');
  const [processedImages, setProcessedImages] = useState<ProcessedImages>({ backgroundRemoved: [] });
  const [processedSubjects, setProcessedSubjects] = useState<ProcessedSubject[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessingStep, setCurrentProcessingStep] = useState('');
  const [currentFiles, setCurrentFiles] = useState<(File & { isPreCut?: boolean })[]>(files);
  
  const { toast } = useToast();

  // Analyze images on component mount
  React.useEffect(() => {
    analyzeImages();
  }, []);

  // Auto-start processing when we have all required data
  React.useEffect(() => {
    if (currentStep === 'cloudinary-rendering' && processedImages.backdropCloudinaryId && processedImages.placement && processedSubjects.length > 0) {
      startCloudinaryRendering();
    }
  }, [currentStep, processedImages.backdropCloudinaryId, processedImages.placement, processedSubjects.length]);

  const analyzeImages = () => {
    // Check if all images are pre-cut (transparent backgrounds already removed)
    const allPreCut = files.every(file => file.isPreCut);

    if (allPreCut) {
      console.log('All images are pre-cut, skipping to rotation step');
      // Convert files to processed image format for rotation
      Promise.all(files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
      })).then(dataUrls => {
        const processedPreCutImages = files.map((file, index) => ({
          name: file.name,
          originalData: dataUrls[index],
          backgroundRemovedData: dataUrls[index],
          size: file.size
        }));
        setProcessedImages({ backgroundRemoved: processedPreCutImages });
        setCurrentStep('precut-rotation');
      });
      return;
    }

    // Images are now pre-processed during upload to be 2048px max and under 5MB
    setCurrentStep('background-removal');
  };

  const handleBackgroundRemovalComplete = (subjects: any[]) => {
    console.log("Background removal complete. Received subjects:", subjects);
    // Convert to ProcessedSubject format
    const processedSubjects = subjects.map(subject => ({
      name: subject.name,
      originalFilename: subject.name,
      imageUrl: subject.backgroundRemovedData || '',
      backgroundRemovedData: subject.backgroundRemovedData,
      size: subject.size
    }));
    setProcessedSubjects(processedSubjects);
    setCurrentStep('rotation'); 
  };

  const handleRotationComplete = async (rotatedImages: Array<{
    name: string;
    originalData?: string;
    backgroundRemovedData?: string;
    size: number;
  }>) => {
    console.log('handleRotationComplete - Received rotatedImages:', rotatedImages);
    
    const processedRotatedImages = rotatedImages.map((img) => ({
      name: img.name,
      originalData: '',
      backgroundRemovedData: img.backgroundRemovedData || '',
      size: img.size
    }));
    
    console.log('Rotation complete - Final processed images:', processedRotatedImages);
    setProcessedImages({ backgroundRemoved: processedRotatedImages });
    setCurrentStep('positioning');
  };

  const handlePreCutRotationComplete = async (rotatedImages: Array<{
    name: string;
    originalData?: string;
    backgroundRemovedData?: string;
    size: number;
  }>) => {
    const processedRotatedImages = rotatedImages.map(img => ({
      name: img.name,
      originalData: '',
      backgroundRemovedData: img.backgroundRemovedData || img.originalData || '',
      size: img.size
    }));
    
    console.log('Pre-cut rotation complete');
    setProcessedImages({ backgroundRemoved: processedRotatedImages });
    
    // For pre-cut, skip to rendering
    toast({
      title: "Ready to render",
      description: "Upload a backdrop to start rendering"
    });
    setCurrentStep('positioning');
  };

  const handlePositioningComplete = async (
    backdrop: string, 
    placement: { x: number; y: number; scale: number }, 
    addBlur: boolean, 
    rotatedSubjects?: string[],
    backdropCloudinaryId?: string
  ) => {
    console.log('🎯 Positioning completed - preparing for Cloudinary rendering');
    console.log('📊 Backdrop Cloudinary ID:', backdropCloudinaryId);
    console.log('📐 Placement:', placement);
    
    // Update processed subjects with rotated data
    if (rotatedSubjects && rotatedSubjects.length > 0) {
      const updatedSubjects = processedSubjects.map((subject, index) => ({
        ...subject,
        backgroundRemovedData: rotatedSubjects[index] || subject.backgroundRemovedData
      }));
      
      setProcessedSubjects(updatedSubjects);
      console.log(`✅ Updated ${updatedSubjects.length} subjects with rotated data`);
    }
    
    setProcessedImages(prev => ({ 
      ...prev, 
      backdrop, 
      backdropCloudinaryId,
      placement, 
      addBlur
    }));
    
    setCurrentStep('cloudinary-rendering');
  };

  // Cloudinary rendering workflow
  const startCloudinaryRendering = async () => {
    console.log('🚀 Starting Cloudinary rendering workflow');
    
    const subjectsToRender = processedSubjects.length > 0 
      ? processedSubjects 
      : processedImages.backgroundRemoved;
    
    if (!subjectsToRender.length || !processedImages.backdropCloudinaryId || !processedImages.placement) {
      console.error('❌ Missing required data for Cloudinary rendering');
      toast({
        title: "Rendering Error", 
        description: "Missing required data. Please try again.",
        variant: "destructive"
      });
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Starting Cloudinary rendering...');

    const results: Array<{ name: string; finalizedData: string }> = [];
    const totalImages = subjectsToRender.length;
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id || 'anonymous';

    try {
      for (let i = 0; i < subjectsToRender.length; i++) {
        const subject = subjectsToRender[i];
        const subjectData = subject.backgroundRemovedData || (subject as any).imageUrl;
        
        setCurrentProcessingStep(`Rendering ${subject.name} (${i + 1}/${totalImages})...`);
        setProgress((i / totalImages) * 100);

        console.log(`Rendering image ${i + 1}/${totalImages}: ${subject.name}`);

        try {
          // Upload subject to Cloudinary (already compressed during upload)
          console.log('📤 Uploading subject to Cloudinary...');
          const subjectUpload = await uploadToCloudinary(
            subjectData,
            'bag',
            userId
          );

          console.log('✅ Subject uploaded:', subjectUpload.public_id);

          // Calculate placement parameters for Cloudinary
          const y_baseline_px = Math.round(processedImages.placement.y * 2048);
          
          // Render composite using Cloudinary
          console.log('🎨 Rendering composite with Cloudinary...');
          const renderResult = await renderComposite({
            bag_public_id: subjectUpload.public_id,
            backdrop_public_id: processedImages.backdropCloudinaryId,
            canvas: MARBLE_STUDIO_GLOSS_V1.canvas!,
            placement: {
              ...MARBLE_STUDIO_GLOSS_V1.placement!,
              y_baseline_px,
              scale: processedImages.placement.scale
            },
            shadow: MARBLE_STUDIO_GLOSS_V1.shadow!,
            reflection: MARBLE_STUDIO_GLOSS_V1.reflection!,
            backdrop_fx: MARBLE_STUDIO_GLOSS_V1.backdrop_fx!,
            safeguards: MARBLE_STUDIO_GLOSS_V1.safeguards!
          });

          console.log('✅ Render complete:', renderResult.url);

          results.push({
            name: subject.name,
            finalizedData: renderResult.url
          });
          
          setCurrentProcessingStep(`✓ Completed ${subject.name} (${i + 1}/${totalImages})`);

        } catch (imageError) {
          console.error(`Failed to render ${subject.name}:`, imageError);
          toast({
            title: `Rendering Failed: ${subject.name}`,
            description: imageError instanceof Error ? imageError.message : 'Unknown error',
            variant: "destructive"
          });
        }

        setProgress(((i + 1) / totalImages) * 100);
      }

      // Store results and move to completion
      setProcessedImages(prev => ({ ...prev, finalResults: results }));
      setProgress(100);
      setCurrentStep('complete');
      setIsProcessing(false);

      toast({
        title: "Rendering Complete!",
        description: `Successfully rendered ${results.length} images`
      });

    } catch (error) {
      console.error('Overall rendering failed:', error);
      setProgress(100);
      setIsProcessing(false);
      
      toast({
        title: "Rendering Failed", 
        description: error instanceof Error ? error.message : "Unknown error occurred",
        variant: "destructive"
      });
    }
  };

  // Render steps
  if (currentStep === 'analysis') {
    return null; // Auto-analysis in useEffect
  }

  if (currentStep === 'preview') {
    return (
      <ImagePreviewStep
        files={currentFiles}
        onContinue={() => setCurrentStep('background-removal')}
        onBack={onBack}
        wasCompressed={false}
      />
    );
  }

  if (currentStep === 'background-removal') {
    return (
      <BackgroundRemovalStep
        files={currentFiles}
        onProcessingComplete={handleBackgroundRemovalComplete}
        onContinue={handleBackgroundRemovalComplete}
        onBack={() => setCurrentStep('preview')}
      />
    );
  }

  if (currentStep === 'rotation') {
    const rotationImages = processedSubjects.length > 0 
      ? processedSubjects.map((subject) => ({
          name: subject.originalFilename || subject.name || 'Processed Image',
          originalData: '',
          backgroundRemovedData: subject.backgroundRemovedData || subject.imageUrl || '',
          size: subject.size || 0
        }))
      : processedImages.backgroundRemoved;

    return (
      <ImageRotationStep
        images={rotationImages}
        onContinue={handleRotationComplete}
        onBack={() => setCurrentStep('background-removal')}
        isPreCut={false}
      />
    );
  }

  if (currentStep === 'precut-rotation') {
    const rotationImages = processedImages.backgroundRemoved;

    return (
      <ImageRotationStep
        images={rotationImages}
        onContinue={handlePreCutRotationComplete}
        onBack={onBack}
        isPreCut={true}
      />
    );
  }

  if (currentStep === 'positioning') {
    return (
      <BackdropPositioning
        cutoutImages={processedSubjects.length > 0 
          ? processedSubjects.map(subject => subject.backgroundRemovedData || subject.imageUrl)
          : processedImages.backgroundRemoved.map(subject => subject.backgroundRemovedData)
        }
        onPositioningComplete={handlePositioningComplete}
        onBack={() => setCurrentStep('rotation')}
      />
    );
  }

  if (currentStep === 'cloudinary-rendering') {
    return (
      <ProcessingStep 
        title="Rendering with Cloudinary"
        description={currentProcessingStep}
        currentStep={currentProcessingStep}
        progress={progress}
        files={currentFiles}
      />
    );
  }

  if (currentStep === 'complete' && processedImages.finalResults) {
    const transparentImagesForLibrary = processedImages.backgroundRemoved.map(img => ({
      name: img.name,
      data: img.backgroundRemovedData
    }));
    
    return (
      <GalleryPreview
        results={processedImages.finalResults.map(result => ({
          name: result.name,
          originalData: '',
          finalizedData: result.finalizedData,
          size: 0
        }))}
        onBack={onBack}
        title="Rendered Images"
        transparentImages={transparentImagesForLibrary}
        aiEnhancedImages={[]}
      />
    );
  }

  return null;
};
