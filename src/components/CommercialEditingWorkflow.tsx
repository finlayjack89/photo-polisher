import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { BackdropPositioning } from './BackdropPositioning';
import { GalleryPreview } from './GalleryPreview';
import { ProcessingStep } from './ProcessingStep';
import { ProcessingWorkflow } from './ProcessingWorkflow';
import { ImagePreviewStep } from './ImagePreviewStep';
import { BackgroundRemovalStep } from './BackgroundRemovalStep';
import { ImageRotationStep } from './ImageRotationStep';
import { supabase } from "@/integrations/supabase/client";
import { 
  positionSubjectOnCanvas,
  fileToDataUrl,
  SubjectPlacement,
  compositeLayers,
  createAiContextImage
} from "@/lib/canvas-utils";
// Removed resizeImageFile import - now using processAndCompressImage in UploadZone
import { useToast } from "@/hooks/use-toast";

interface CommercialEditingWorkflowProps {
  files: (File & { isPreCut?: boolean })[];
  onBack: () => void;
}

type WorkflowStep = 'analysis' | 'compression' | 'preview' | 'background-removal' | 'rotation' | 'positioning' | 'client-compositing' | 'processing' | 'preview-results' | 'ai-enhancement' | 'complete' | 'precut-enhancement' | 'precut-rotation';

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
  const [processedSubjects, setProcessedSubjects] = useState<any[]>([]);
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
  
  // Phase 1: Add comprehensive logging and data tracking
  const [dataFlowLog, setDataFlowLog] = useState<string[]>([]);
  const [shadowLayers, setShadowLayers] = useState<Record<string, string>>({});
  const [pureBackdropData, setPureBackdropData] = useState<string | null>(null);

  const logDataFlow = (message: string) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    console.log(`🔍 DATA FLOW: ${logEntry}`);
    setDataFlowLog(prev => [...prev, logEntry]);
  };
  
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
      console.log('All images are pre-cut, skipping to rotation step');
      // Convert files to processed image format for rotation
      const preCutImages = files.map(file => ({
        name: file.name,
        originalData: '', // Will be set when image is loaded
        backgroundRemovedData: '', // Will be set when image is loaded
        size: file.size
      }));
      
      // Load file data for rotation step
      Promise.all(files.map(file => {
        return new Promise<string>((resolve) => {
          const reader = new FileReader();
          reader.onload = (e) => resolve(e.target?.result as string);
          reader.readAsDataURL(file);
        });
      })).then(dataUrls => {
        const processedPreCutImages = preCutImages.map((img, index) => ({
          ...img,
          originalData: dataUrls[index],
          backgroundRemovedData: dataUrls[index]
        }));
        setProcessedImages({ backgroundRemoved: processedPreCutImages });
        setCurrentStep('precut-rotation');
      });
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

  const handleBackgroundRemovalComplete = (subjects: any[]) => {
    console.log("Background removal complete. Received subjects:", subjects);
    
    // DEBUG: Log the actual structure of subjects to fix rotation preview
    subjects.forEach((subject, index) => {
      console.log(`Subject ${index} structure:`, {
        keys: Object.keys(subject),
        hasBackgroundRemovedData: !!subject.backgroundRemovedData,
        hasProcessedImageUrl: !!subject.processedImageUrl,
        hasData: !!subject.data,
        hasUrl: !!subject.url,
        backgroundRemovedDataLength: subject.backgroundRemovedData?.length,
        processedImageUrlLength: subject.processedImageUrl?.length,
        dataLength: subject.data?.length,
        urlLength: subject.url?.length
      });
    });
    
    setProcessedSubjects(subjects);
    // We also advance to the next step in the workflow here
    setCurrentStep('rotation'); 
  };

  const handleRotationComplete = async (rotatedImages: Array<{
    name: string;
    originalData?: string;
    backgroundRemovedData?: string;
    size: number;
  }>) => {
    console.log('handleRotationComplete - Received rotatedImages:', rotatedImages);
    
    // CRITICAL: Ensure only transparent subject data is preserved
    const processedRotatedImages = rotatedImages.map((img, index) => {
      console.log(`Processing rotated image ${index}:`, {
        name: img.name,
        hasOriginalData: !!img.originalData,
        hasBackgroundRemovedData: !!img.backgroundRemovedData,
        backgroundRemovedDataIsPNG: img.backgroundRemovedData?.includes('data:image/png'),
        size: img.size
      });
      
      // CRITICAL: Explicitly validate that we only keep PNG transparent data
      const transparentSubjectData = img.backgroundRemovedData;
      if (transparentSubjectData && !transparentSubjectData.includes('data:image/png')) {
        console.error(`ERROR: Non-PNG data detected for ${img.name}. This will cause original image contamination!`);
        throw new Error(`Invalid data format for ${img.name}. Must be PNG with transparency.`);
      }
      
      return {
        name: img.name,
        originalData: '', // COMPLETELY DISCARD original data
        backgroundRemovedData: transparentSubjectData || '', // Keep only transparent PNG subject
        size: img.size
      };
    });
    
    console.log('Rotation complete - Final processed images:', processedRotatedImages);
    console.log('✓ VERIFIED: All data is transparent PNG format - original images purged');
    setProcessedImages({ backgroundRemoved: processedRotatedImages });
    setCurrentStep('positioning');
  };

  const handlePreCutRotationComplete = async (rotatedImages: Array<{
    name: string;
    originalData?: string;
    backgroundRemovedData?: string;
    size: number;
  }>) => {
    // CRITICAL: For pre-cut images, ensure we only use the transparent data
    const processedRotatedImages = rotatedImages.map(img => ({
      name: img.name,
      originalData: '', // Discard any original data completely
      backgroundRemovedData: img.backgroundRemovedData || img.originalData || '', // Keep rotated transparent subject
      size: img.size
    }));
    
    console.log('Pre-cut rotation complete - maintaining transparent-only subjects');
    setProcessedImages({ backgroundRemoved: processedRotatedImages });
    setCurrentStep('precut-enhancement');
  };

  const handlePositioningComplete = (backdrop: string, placement: SubjectPlacement, addBlur: boolean, rotatedSubjects?: string[]) => {
    logDataFlow('🎯 Positioning completed');
    logDataFlow(`📊 Backdrop format: ${backdrop?.substring(0, 50)}`);
    logDataFlow(`📐 Placement: ${JSON.stringify(placement)}`);
    
    // CRITICAL: Store the pure backdrop separately
    setPureBackdropData(backdrop);
    logDataFlow(`✅ Pure backdrop stored: ${backdrop?.length} chars`);
    
    // If rotated subjects are provided, update the processed subjects
    if (rotatedSubjects && rotatedSubjects.length > 0) {
      logDataFlow(`🔄 Updating ALL subjects with rotated versions: ${rotatedSubjects.length} subjects`);
      
      // Update ALL processed subjects with their corresponding rotated data
      const updatedSubjects = processedSubjects.map((subject, index) => ({
        ...subject,
        backgroundRemovedData: rotatedSubjects[index] || subject.backgroundRemovedData
      }));
      
      // Also update processedImages if they exist  
      if (processedImages.backgroundRemoved.length > 0) {
        const updatedBackgroundRemoved = processedImages.backgroundRemoved.map((subject, index) => ({
          ...subject,
          backgroundRemovedData: rotatedSubjects[index] || subject.backgroundRemovedData
        }));
        
        setProcessedImages(prev => ({ 
          ...prev, 
          backdrop, 
          placement, 
          addBlur,
          backgroundRemoved: updatedBackgroundRemoved 
        }));
        
        logDataFlow(`✅ Updated ${updatedBackgroundRemoved.length} processedImages with rotated data`);
      }
      
      setProcessedSubjects(updatedSubjects);
      logDataFlow(`✅ Updated ${updatedSubjects.length} processedSubjects with rotated data`);
      
      // Log the first few characters of each rotated subject for debugging
      rotatedSubjects.forEach((rotatedData, index) => {
        logDataFlow(`🔄 Subject ${index}: ${rotatedData.substring(0, 50)}...`);
      });
    } else {
      setProcessedImages(prev => ({ ...prev, backdrop, placement, addBlur }));
    }
    
    setCurrentStep('processing');
  };

  // Phase 2 Option A: Pure layer compositing workflow
  const startV5SingleImageProcessing = async () => {
    logDataFlow('🚀 Starting secure layer-based processing workflow');
    
    if (!processedImages.backgroundRemoved?.length || !pureBackdropData || !processedImages.placement) {
      logDataFlow('❌ Missing required data for processing');
      toast({
        title: "Processing Error", 
        description: "Missing required data for processing. Please try again.",
        variant: "destructive"
      });
      return;
    }

    logDataFlow(`📋 Processing ${processedImages.backgroundRemoved.length} subjects with pure backdrop`);
    setCurrentStep('processing');
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Starting secure layer-based processing...');

    const results: Array<{ name: string; finalizedData: string }> = [];
    const totalImages = processedImages.backgroundRemoved.length;

    try {
      // Process each image individually with real-time progress
      for (let i = 0; i < processedImages.backgroundRemoved.length; i++) {
        const image = processedImages.backgroundRemoved[i];
        
        setCurrentProcessingStep(`Processing ${image.name} (${i + 1}/${totalImages})...`);
        setProgress((i / totalImages) * 100);

        console.log(`V5 Processing image ${i + 1}/${totalImages}: ${image.name}`);
        logDataFlow(`📊 Using backgroundRemovedData: ${image.backgroundRemovedData.substring(0, 50)}...`);

        try {
          // Phase 2 Option A: Generate shadow layer using pure backdrop + transparent subject
          logDataFlow(`🎭 Generating shadow layer for ${image.name}...`);
          
          const { data: shadowData, error: shadowError } = await supabase.functions.invoke('generate-shadow-layer', {
            body: {
              backdrop: pureBackdropData,
              subjectData: image.backgroundRemovedData,
              placement: processedImages.placement,
              imageName: image.name
            }
          });

          if (shadowError) {
            logDataFlow(`❌ Shadow generation failed for ${image.name}: ${shadowError.message}`);
            throw new Error(`Shadow generation failed: ${shadowError.message}`);
          }

          if (!shadowData?.success || !shadowData?.result?.shadowLayerData) {
            logDataFlow(`❌ Shadow generation returned no data for ${image.name}`);
            throw new Error('Shadow generation returned no results');
          }

          const shadowLayerData = shadowData.result.shadowLayerData;
          logDataFlow(`✅ Shadow layer generated for ${image.name} (${shadowLayerData.length} chars)`);
          
          // Store shadow layer for potential reuse
          setShadowLayers(prev => ({
            ...prev,
            [image.name]: shadowLayerData
          }));

          // Phase 3: Secure client-side compositing with validation
          logDataFlow(`🎨 Starting secure client-side compositing for ${image.name}...`);
          setCurrentProcessingStep(`Compositing ${image.name} with pure layers...`);
          
          // Validate inputs before compositing
          if (!image.backgroundRemovedData.includes('data:image/png')) {
            logDataFlow(`❌ CRITICAL: Subject ${image.name} is not transparent PNG!`);
            throw new Error(`Subject ${image.name} is not transparent PNG - cannot composite safely`);
          }
          
          logDataFlow(`✅ SECURITY CHECK PASSED: ${image.name} is transparent PNG`);
          logDataFlow(`✅ Using pure backdrop: ${pureBackdropData.length} chars`);
          logDataFlow(`✅ Using shadow layer: ${shadowLayerData.length} chars`);
          logDataFlow(`✅ Using rotated subject: ${image.backgroundRemovedData.substring(0, 50)}...`);
          
          const finalImageUrl = await compositeLayers(
            pureBackdropData,
            shadowLayerData,
            image.backgroundRemovedData,
            processedImages.placement
          );

          logDataFlow(`✅ Client compositing complete for ${image.name} (${finalImageUrl.length} chars)`);
          
          results.push({
            name: image.name,
            finalizedData: finalImageUrl
          });
          
          setCurrentProcessingStep(`✓ Completed ${image.name} (${i + 1}/${totalImages})`);

        } catch (imageError) {
          console.error(`Failed to process ${image.name}:`, imageError);
          logDataFlow(`⚠️ Attempting fallback client-side compositing for ${image.name}...`);
          
          try {
            // Fallback: Simple client-side compositing without AI shadows
            setCurrentProcessingStep(`Creating fallback composite for ${image.name}...`);
            
            const fallbackComposite = await compositeLayers(
              pureBackdropData,
              null, // No shadow layer
              image.backgroundRemovedData,
              processedImages.placement
            );
            
            results.push({
              name: image.name,
              finalizedData: fallbackComposite
            });
            
            logDataFlow(`✅ Fallback composite created for ${image.name}`);
            setCurrentProcessingStep(`✓ Completed ${image.name} with fallback (${i + 1}/${totalImages})`);
            
          } catch (fallbackError) {
            console.error(`Fallback also failed for ${image.name}:`, fallbackError);
            logDataFlow(`❌ Both primary and fallback processing failed for ${image.name}`);
            setCurrentProcessingStep(`⚠ Failed to process ${image.name}, continuing with others...`);
          }
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
    console.log('startClientCompositing - Starting with pure backdrop and transparent subjects');
    console.log('startClientCompositing - Backdrop format:', backdrop?.substring(0, 50));
    console.log('startClientCompositing - Subjects to process:', processedImages.backgroundRemoved?.length);
    
    setIsProcessing(true);
    setProgress(0);
    setCurrentProcessingStep('Creating client-side composition...');

    try {
      // CRITICAL: Verify backdrop is pure (not contaminated)
      if (!backdrop) {
        throw new Error('No backdrop provided for compositing');
      }
      
      // Get backdrop image
      const backdropImg = new Image();
      await new Promise((resolve, reject) => {
        backdropImg.onload = () => {
          console.log('startClientCompositing - Backdrop loaded:', `${backdropImg.width}x${backdropImg.height}`);
          resolve(null);
        };
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

        // CRITICAL: Verify subject is transparent PNG
        if (!subject.backgroundRemovedData) {
          console.error(`ERROR: No transparent data for subject ${subject.name}`);
          throw new Error(`No transparent data available for ${subject.name}`);
        }
        
        if (!subject.backgroundRemovedData.includes('data:image/png')) {
          console.error(`ERROR: Subject ${subject.name} is not PNG format`);
          throw new Error(`Subject ${subject.name} must be PNG with transparency`);
        }
        
        console.log(`✓ VERIFIED: Subject ${subject.name} is transparent PNG`);

        // Create final composite with PURE BACKDROP + TRANSPARENT SUBJECT ONLY
        const finalCanvas = document.createElement('canvas');
        finalCanvas.width = backdropImg.naturalWidth;
        finalCanvas.height = backdropImg.naturalHeight;
        const finalCtx = finalCanvas.getContext('2d');
        
        if (!finalCtx) throw new Error('Could not get canvas context');

        console.log(`Drawing pure backdrop for ${subject.name}...`);
        // Draw PURE backdrop first
        finalCtx.drawImage(backdropImg, 0, 0);

        // Load and position the transparent subject
        const subjectImg = new Image();
        await new Promise((resolve, reject) => {
          subjectImg.onload = () => {
            console.log(`Transparent subject loaded for ${subject.name}: ${subjectImg.width}x${subjectImg.height}`);
            resolve(null);
          };
          subjectImg.onerror = reject;
          subjectImg.src = subject.backgroundRemovedData;
        });

        // Calculate positioning based on placement
        const subjectAspectRatio = subjectImg.naturalWidth / subjectImg.naturalHeight;
        const scaledWidth = finalCanvas.width * placement.scale;
        const scaledHeight = scaledWidth / subjectAspectRatio;
        const dx = (placement.x * finalCanvas.width) - (scaledWidth / 2);
        const dy = (placement.y * finalCanvas.height) - (scaledHeight / 2);

        console.log(`Drawing positioned transparent subject for ${subject.name}:`, {
          position: `${Math.round(dx)}, ${Math.round(dy)}`,
          size: `${Math.round(scaledWidth)}x${Math.round(scaledHeight)}`,
          placement
        });

        // Draw ONLY the transparent subject at the correct position
        finalCtx.drawImage(subjectImg, dx, dy, scaledWidth, scaledHeight);

        // Apply blur if requested
        if (addBlur) {
          finalCtx.filter = 'blur(1px)';
          finalCtx.drawImage(backdropImg, 0, 0);
          finalCtx.filter = 'none';
          finalCtx.drawImage(subjectImg, dx, dy, scaledWidth, scaledHeight);
        }

        const finalComposite = finalCanvas.toDataURL('image/png');
        console.log(`✓ COMPLETED: Clean composite for ${subject.name} (${finalComposite.length} bytes)`);

        clientComposited.push({
          name: subject.name,
          compositedData: finalComposite
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
    if (!processedImages.clientComposited || !pureBackdropData) return;

    setIsProcessing(true);
    setProgress(0);
    setCurrentStep('ai-enhancement');
    setCurrentProcessingStep('Enhancing images with AI...');

    try {
      const enhancedImages = [];
      
      for (let i = 0; i < processedImages.clientComposited.length; i++) {
        const image = processedImages.clientComposited[i];
        setProgress((i / processedImages.clientComposited.length) * 100);
        
        // Convert backdrop URL to data URL if needed
        let backdropDataUrl: string;
        if (pureBackdropData.startsWith('data:')) {
          backdropDataUrl = pureBackdropData;
        } else {
          console.log('🔍 Converting backdrop URL to data URL for AI processing...');
          const response = await fetch(pureBackdropData);
          if (!response.ok) throw new Error(`Failed to fetch backdrop: ${response.statusText}`);
          const blob = await response.blob();
          backdropDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          });
        }

        // Find the original background-removed subject
        const originalSubject = processedImages.backgroundRemoved.find(bg => bg.name === image.name);
        if (!originalSubject) {
          console.error(`Could not find original subject for ${image.name}`);
          enhancedImages.push({
            name: image.name,
            finalizedData: image.compositedData
          });
          continue;
        }

        // Create context image for AI
        const contextImage = await createAiContextImage(
          backdropDataUrl,
          originalSubject.backgroundRemovedData,
          {
            position: { x: 0.5, y: 0.5 },
            size: { width: 400, height: 400 },
            rotation: 0
          }
        );

        // Call V5 processing for shadow generation
        console.log(`🎭 Generating AI shadows for ${image.name}...`);
        const { data, error } = await supabase.functions.invoke('v5-process-single-image', {
          body: {
            contextImageUrl: contextImage,
            dimensions: { width: 1024, height: 1024 }
          },
        });

        if (error) {
          console.error(`Failed to generate shadows for ${image.name}:`, error);
          // Fall back to original composited image
          enhancedImages.push({
            name: image.name,
            finalizedData: image.compositedData
          });
        } else {
          // Composite final image with shadows
          const finalImage = await compositeLayers(
            backdropDataUrl,
            data.imageData,
            originalSubject.backgroundRemovedData,
            { x: 0.5, y: 0.5, scale: 0.4 }
          );
          
          enhancedImages.push({
            name: image.name,
            finalizedData: finalImage
          });
        }
      }

      setProgress(100);
      setProcessedImages(prev => ({
        ...prev,
        aiEnhanced: enhancedImages
      }));

      toast({
        title: "AI Enhancement Complete",
        description: `Successfully enhanced ${enhancedImages.length} images with AI-generated shadows and reflections!`
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
        onProcessingComplete={handleBackgroundRemovalComplete}
        onContinue={handleBackgroundRemovalComplete}
        onBack={() => setCurrentStep('preview')}
      />
    );
  }

  if (currentStep === 'rotation') {
    // Use processedSubjects if available, otherwise fall back to processedImages.backgroundRemoved
    console.log('Preparing rotation step data...');
    console.log('processedSubjects available:', processedSubjects.length > 0);
    console.log('processedSubjects structure:', processedSubjects);
    
    const rotationImages = processedSubjects.length > 0 
      ? processedSubjects.map((subject, index) => {
          // Try multiple possible property names for the transparent subject data
          const transparentData = subject.backgroundRemovedData || 
                                subject.processedImageUrl || 
                                subject.data ||
                                subject.url ||
                                '';
          
          console.log(`Mapping subject ${index} for rotation:`, {
            name: subject.original_filename || subject.name || 'Processed Image',
            hasTransparentData: !!transparentData,
            transparentDataLength: transparentData?.length,
            transparentDataFormat: transparentData?.substring(0, 50),
            allKeys: Object.keys(subject)
          });
          
          return {
            name: subject.original_filename || subject.name || 'Processed Image',
            originalData: '', // Never pass original data
            backgroundRemovedData: transparentData,
            size: subject.size || 0
          };
        })
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
    // For pre-cut images, also check processedSubjects
    const rotationImages = processedSubjects.length > 0 
      ? processedSubjects.map(subject => ({
          name: subject.original_filename || subject.name || 'Pre-cut Image',
          originalData: subject.backgroundRemovedData || subject.processedImageUrl,
          backgroundRemovedData: subject.backgroundRemovedData || subject.processedImageUrl,
          size: subject.size || 0
        }))
      : processedImages.backgroundRemoved;

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
          ? processedSubjects.map(subject => subject.backgroundRemovedData || subject.processedImageUrl)
          : processedImages.backgroundRemoved.map(subject => subject.backgroundRemovedData)
        }
        onPositioningComplete={handlePositioningComplete}
        onBack={() => setCurrentStep('rotation')}
      />
    );
  }

  if (currentStep === 'processing') {
    return (
      <ProcessingWorkflow
        processedSubjects={processedSubjects.length > 0 ? processedSubjects : []}
        backdrop={processedImages.backdrop}
        files={currentFiles}
        onComplete={(processedFiles) => {
          console.log('Processing complete, received files:', processedFiles);
          setCurrentStep('preview-results');
          setIsProcessing(false);
        }}
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

  if (currentStep === 'preview-results') {
    // Handle V5 processing results
    if (processedImages.finalResults && processedImages.finalResults.length > 0) {
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
    
    // Handle case where processing failed or no results
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold">Processing Results</h2>
          <p className="text-muted-foreground">
            {processedImages.finalResults?.length === 0 
              ? "No images were successfully processed. Please try again."
              : "Processing completed with some issues."}
          </p>
          <div className="flex gap-4 justify-center">
            <Button onClick={onBack} variant="outline">
              Start Over
            </Button>
            <Button onClick={() => setCurrentStep('positioning')} variant="outline">
              Try Different Position
            </Button>
          </div>
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