import { useState, useEffect } from "react";
import { Check, Clock, Image as ImageIcon, Scissors, Sparkles, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { renderComposite, MARBLE_STUDIO_GLOSS_V1, type RenderParams } from '@/lib/cloudinary-render';

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
  { id: 'render', label: 'Cloudinary Render', icon: Sparkles },
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
      
      console.log('Starting Cloudinary render workflow...');
      
      const processedFiles: ProcessedFile[] = [];
      
      for (let i = 0; i < processedSubjects.length; i++) {
        const subject = processedSubjects[i];
        
        // Build render params using house preset
        const renderParams: RenderParams = {
          ...MARBLE_STUDIO_GLOSS_V1,
          bag_public_id: `temp/${subject.name}`, // TODO: Upload to Cloudinary first
          backdrop_public_id: 'temp/backdrop', // TODO: Upload to Cloudinary first
        } as RenderParams;
        
        console.log(`Rendering ${subject.name} with Cloudinary...`);
        setCurrentStep(1);
        
        const { url } = await renderComposite(renderParams);
        
        console.log(`✅ Rendered ${subject.name}:`, url);
        
        processedFiles.push({
          originalName: subject.original_filename,
          processedName: subject.name,
          data: url,
          size: 1024,
          format: 'image/png',
          analysis: {
            description: 'Rendered with Cloudinary Marble Studio Gloss v1 preset',
            suggestions: ['Lossless PNG with shadows and reflections'],
            quality_score: 95,
            detected_issues: [],
            enhancement_recommendations: []
          }
        });
        
        setProgress(20 + (i / processedSubjects.length) * 70);
        setCompletedFiles(i + 1);
      }
      
      setCurrentStep(2);
      setProgress(100);
      
      toast({
        title: "Rendering Complete",
        description: `Successfully rendered ${processedSubjects.length} images with Cloudinary`,
      });

      // Complete the workflow
      setTimeout(() => {
        onComplete(processedFiles);
      }, 1000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Rendering error:', err);
      
      toast({
        title: "Rendering Failed",
        description: errorMessage,
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Processing Header */}
      <div className="text-center space-y-4">
        <h2 className="text-3xl font-bold text-foreground">
          Rendering Your Photos
        </h2>
        <p className="text-muted-foreground">
          Cloudinary is rendering {files.length} photos with the Marble Studio Gloss v1 preset
        </p>
      </div>

      {/* Progress Steps */}
      <Card className="shadow-medium">
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <div className="w-8 h-8 bg-gradient-electric rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-electric-foreground animate-spin" />
            </div>
            <span>Rendering Pipeline</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Step Indicators */}
          <div className="grid grid-cols-3 gap-2 md:gap-4">
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
                Rendering Files
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
            <p className="text-destructive font-medium">Rendering Error</p>
            <p className="text-sm text-destructive/80 mt-1">{error}</p>
          </div>
          <Button onClick={processImages} disabled={isProcessing}>
            <Sparkles className="w-4 h-4 mr-2" />
            Retry Rendering
          </Button>
        </div>
      )}
      
      {!error && (
        <div className="flex justify-center">
          <Button variant="outline" disabled>
            <Clock className="w-4 h-4 mr-2" />
            {isProcessing ? 'Rendering in Progress...' : 'Rendering Complete'}
          </Button>
        </div>
      )}
    </div>
  );
};