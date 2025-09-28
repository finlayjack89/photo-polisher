import { useState, useEffect } from "react";
import { Check, Clock, Image as ImageIcon, Scissors, Sparkles, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { compositeLayers, createAiContextImage } from '@/lib/canvas-utils';

interface ProcessedSubject {
  original_filename: string;
  processedImageUrl: string;
  name: string;
  backgroundRemovedData: string;
}

interface ProcessingWorkflowProps {
  processedSubjects?: ProcessedSubject[];
  backdrop?: any;
  files: File[];
  onComplete: (processedFiles: ProcessedFile[]) => void;
}

interface ProcessedFile {
  originalName: string;
  processedName: string;
  data: string;
  size: number;
  format: string;
  analysis?: {
    description: string;
    suggestions: string[];
    quality_score: number;
    detected_issues: string[];
    enhancement_recommendations: string[];
  };
}

const processingSteps = [
  { id: 'upload', label: 'Uploading Files', icon: ImageIcon },
  { id: 'analyze', label: 'AI Analysis', icon: Sparkles },
  { id: 'convert', label: 'Converting Images', icon: Scissors },
  { id: 'compress', label: 'Smart Compression', icon: Scissors },
  { id: 'complete', label: 'Processing Complete', icon: Download },
];

export const ProcessingWorkflow = ({ processedSubjects, backdrop, files, onComplete }: ProcessingWorkflowProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [completedFiles, setCompletedFiles] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [subjectUrls, setSubjectUrls] = useState<string[]>([]);
  const [currentSubjectIndex, setCurrentSubjectIndex] = useState(0);
  const { toast } = useToast();

  // Extract image URLs from processedSubjects
  useEffect(() => {
    if (processedSubjects && processedSubjects.length > 0) {
      const urls = processedSubjects.map(subject => subject.backgroundRemovedData || subject.processedImageUrl);
      setSubjectUrls(urls);
      console.log('Extracted subject URLs:', urls);
    }
  }, [processedSubjects]);

  // Convert File objects to base64 for API
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove the data URL prefix to get just the base64 data
        resolve(result.split(',')[1]);
      };
      reader.onerror = error => reject(error);
    });
  };

  useEffect(() => {
    if (!isProcessing) {
      processImages();
    }
  }, []);

  const processImages = async () => {
    if (!processedSubjects || processedSubjects.length === 0 || !backdrop) {
      setError('Missing processed subjects or backdrop data');
      return;
    }

    setIsProcessing(true);
    setError(null);
    
    try {
      setCurrentStep(0);
      setProgress(10);
      
      console.log('Starting AI-enhanced processing workflow...');
      
      for (let i = 0; i < processedSubjects.length; i++) {
        await handleProcessImage(i);
        setProgress(20 + (i / processedSubjects.length) * 70);
      }
      
      setCurrentStep(4);
      setProgress(100);
      setCompletedFiles(processedSubjects.length);
      
      toast({
        title: "AI Processing Complete",
        description: `Successfully processed ${processedSubjects.length} images with AI-generated shadows and reflections`,
      });

      // Complete the workflow
      setTimeout(() => {
        // Convert processedSubjects to ProcessedFile format
        const processedFilesWithAnalysis: ProcessedFile[] = processedSubjects.map((subject, index) => ({
          originalName: subject.original_filename,
          processedName: subject.name,
          data: subject.processedImageUrl || subject.backgroundRemovedData,
          size: 1024, // Default size
          format: 'image/png',
          analysis: {
            description: 'AI-enhanced with shadows and reflections',
            suggestions: ['Image enhanced with AI-generated shadows and reflections'],
            quality_score: 95,
            detected_issues: [],
            enhancement_recommendations: []
          }
        }));
        
        onComplete(processedFilesWithAnalysis);
      }, 1000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('AI processing error:', err);
      
      toast({
        title: "AI Processing Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const handleProcessImage = async (subjectIndex: number) => {
    if (!backdrop || !processedSubjects) return;
    
    try {
      const subject = processedSubjects[subjectIndex];
      
      // Handle backdrop data - it can be either a string data URL or an object with url property
      let backdropDataUrl: string;
      if (typeof backdrop === 'string') {
        // backdrop is already a data URL string
        backdropDataUrl = backdrop;
        console.log('✅ Using backdrop as data URL directly');
      } else if (backdrop.url && backdrop.url.startsWith('data:')) {
        backdropDataUrl = backdrop.url;
        console.log('✅ Using backdrop.url as data URL');
      } else if (backdrop.url) {
        // Fetch the backdrop and convert to data URL
        console.log('🔍 Converting backdrop URL to data URL for AI processing...');
        const response = await fetch(backdrop.url);
        if (!response.ok) throw new Error(`Failed to fetch backdrop: ${response.statusText}`);
        const blob = await response.blob();
        backdropDataUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result as string);
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      } else {
        throw new Error('Invalid backdrop data format');
      }
      
      const subjectUrl = subject.backgroundRemovedData;
      
      // Get rotation from the CommercialEditingWorkflow if available
      const rotation = 0; // Default rotation, this should come from the workflow state
      
      const subjectConfig = {
        position: { x: 0.5, y: 0.5 }, // Default center position
        size: { width: 400, height: 400 }, // Default size
        rotation: rotation
      };

      // --- STEP 1: Create the high-quality context image for the AI ---
      console.log("Creating AI context image as PNG...");
      const contextImage = await createAiContextImage(backdropDataUrl, subjectUrl, subjectConfig);

      // --- STEP 2: Call the AI to generate the shadow layer ---
      console.log("Invoking AI to generate shadow layer...");
      // Get dimensions from backdrop if available, otherwise use defaults
      let backdropWidth = 1024;
      let backdropHeight = 1024;
      
      if (typeof backdrop === 'object' && backdrop.width && backdrop.height) {
        backdropWidth = backdrop.width;
        backdropHeight = backdrop.height;
      } else {
        // Try to get dimensions from the image data
        try {
          const img = new Image();
          img.src = backdropDataUrl;
          await new Promise((resolve, reject) => {
            img.onload = () => {
              backdropWidth = img.width;
              backdropHeight = img.height;
              resolve(null);
            };
            img.onerror = reject;
          });
        } catch (e) {
          console.warn('Could not determine backdrop dimensions, using defaults');
        }
      }

      const { data, error } = await supabase.functions.invoke('v5-process-single-image', {
        body: {
          contextImageUrl: contextImage,
          dimensions: { width: backdropWidth, height: backdropHeight }
        },
      });

      if (error) throw error;
      const shadowLayerUrl = data.imageData;

      // --- STEP 3: Composite the final image using all three layers ---
      console.log("Compositing final image...");
      const placementConfig = {
        x: 0.5,
        y: 0.5,
        scale: 0.4
      };
      
      const finalImage = await compositeLayers(
        backdropDataUrl,
        shadowLayerUrl,
        subjectUrl,
        placementConfig
      );
      
      // Update the processed subject with the final enhanced image
      processedSubjects[subjectIndex] = {
        ...subject,
        processedImageUrl: finalImage
      };

    } catch (err) {
      console.error(`Processing failed for subject ${subjectIndex}:`, err);
      throw err;
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Processing Header */}
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold text-foreground">
          Processing Your Photos
        </h2>
        <p className="text-muted-foreground">
          Our AI is working its magic on {files.length} photos
        </p>
      </div>

      {/* Progress Steps */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-electric rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-electric-foreground animate-spin" />
            </div>
            <span>Processing Pipeline</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step Indicators */}
          <div className="grid grid-cols-5 gap-2 md:gap-4">
            {processingSteps.map((step, index) => {
              const isActive = index === currentStep;
              const isCompleted = index < currentStep;
              const Icon = step.icon;
              
              return (
                <div key={step.id} className="text-center space-y-2">
                  <div className={cn(
                    "w-12 h-12 mx-auto rounded-full flex items-center justify-center transition-smooth",
                    isCompleted && "bg-success text-success-foreground",
                    isActive && "bg-gradient-electric text-electric-foreground",
                    !isActive && !isCompleted && "bg-muted text-muted-foreground"
                  )}>
                    {isCompleted ? (
                      <Check className="w-6 h-6" />
                    ) : (
                      <Icon className={cn("w-6 h-6", isActive && "animate-pulse")} />
                    )}
                  </div>
                  <p className={cn(
                    "text-sm font-medium",
                    isActive && "text-electric",
                    isCompleted && "text-success",
                    !isActive && !isCompleted && "text-muted-foreground"
                  )}>
                    {step.label}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <span className="text-sm font-medium text-foreground">
                {processingSteps[currentStep].label}
              </span>
              <span className="text-sm text-muted-foreground">
                {Math.round(progress)}%
              </span>
            </div>
            <Progress value={progress} className="h-2" />
          </div>

          {/* File Progress */}
          <div className="flex items-center justify-between bg-muted/30 rounded-lg p-4">
            <div className="flex items-center space-x-3">
              <Clock className="w-5 h-5 text-electric" />
              <span className="font-medium text-foreground">
                Processing Files
              </span>
            </div>
            <Badge variant="outline">
              {completedFiles} / {files.length} completed
            </Badge>
          </div>
        </CardContent>
      </Card>

      {/* File Grid Preview */}
      <Card className="shadow-soft">
        <CardHeader>
          <CardTitle>Your Photos</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {(subjectUrls.length > 0 ? subjectUrls : files).map((item, index) => {
              const isProcessed = index < completedFiles;
              const isProcessing = index === completedFiles;
              const isUrl = typeof item === 'string';
              const fileName = isUrl 
                ? (processedSubjects?.[index]?.name || processedSubjects?.[index]?.original_filename || `Image ${index + 1}`)
                : (item as File)?.name || `Image ${index + 1}`;
              
              return (
                <div key={index} className="relative group cursor-pointer" onClick={() => setCurrentSubjectIndex(index)}>
                  <div className={cn(
                    "aspect-square rounded-lg border-2 flex items-center justify-center transition-smooth overflow-hidden",
                    currentSubjectIndex === index && subjectUrls.length > 0 && "border-electric bg-electric/5 ring-2 ring-electric/20",
                    isProcessed && "border-success bg-success/5",
                    isProcessing && "border-electric bg-electric/5",
                    !isProcessed && !isProcessing && !isUrl && "border-dashed border-muted bg-muted/30"
                  )}>
                    {isUrl ? (
                      <img 
                        src={item}
                        alt={fileName}
                        className="w-full h-full object-cover rounded-lg"
                      />
                    ) : (
                      <div className="text-center space-y-2">
                        <ImageIcon className={cn(
                          "w-8 h-8 mx-auto",
                          isProcessed && "text-success",
                          isProcessing && "text-electric animate-pulse",
                          !isProcessed && !isProcessing && "text-muted-foreground"
                        )} />
                        <p className="text-xs text-muted-foreground truncate px-2">
                          {fileName}
                        </p>
                      </div>
                    )}
                    
                    {isProcessed && (
                      <div className="absolute -top-2 -right-2 w-6 h-6 bg-success rounded-full flex items-center justify-center">
                        <Check className="w-4 h-4 text-success-foreground" />
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Action Buttons */}
      {error && (
        <div className="text-center">
          <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-4 mb-4">
            <p className="text-destructive font-medium">Processing Error</p>
            <p className="text-sm text-destructive/80 mt-1">{error}</p>
          </div>
          <Button onClick={processImages} disabled={isProcessing}>
            <Sparkles className="w-4 h-4 mr-2" />
            Retry Processing
          </Button>
        </div>
      )}
      
      {!error && (
        <div className="flex justify-center">
          <Button variant="outline" disabled>
            <Clock className="w-4 h-4 mr-2" />
            {isProcessing ? 'Processing in Progress...' : 'Processing Complete'}
          </Button>
        </div>
      )}
    </div>
  );
};