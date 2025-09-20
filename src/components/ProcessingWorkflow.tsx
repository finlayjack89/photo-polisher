import { useState, useEffect } from "react";
import { Check, Clock, Image as ImageIcon, Scissors, Sparkles, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ProcessingWorkflowProps {
  files: File[];
  onComplete: (processedFiles: ProcessedFile[]) => void;
}

interface ProcessedFile {
  originalName: string;
  processedName: string;
  data: string;
  size: number;
  format: string;
}

const processingSteps = [
  { id: 'upload', label: 'Uploading Files', icon: ImageIcon },
  { id: 'convert', label: 'Converting Images', icon: Scissors },
  { id: 'process', label: 'Optimizing Quality', icon: Sparkles },
  { id: 'complete', label: 'Processing Complete', icon: Download },
];

export const ProcessingWorkflow = ({ files, onComplete }: ProcessingWorkflowProps) => {
  const [currentStep, setCurrentStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [completedFiles, setCompletedFiles] = useState(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

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
    setIsProcessing(true);
    setError(null);
    
    try {
      // Step 1: Upload step
      setCurrentStep(0);
      setProgress(10);
      
      const filesData = await Promise.all(
        files.map(async (file) => ({
          data: await fileToBase64(file),
          name: file.name,
          type: file.type,
        }))
      );

      // Step 2: Processing step
      setCurrentStep(1);
      setProgress(30);

      // Call the edge function
      const { data, error: supabaseError } = await supabase.functions.invoke('process-images', {
        body: {
          files: filesData,
          processingOptions: {
            quality: 90
          }
        }
      });

      setCurrentStep(2);
      setProgress(80);

      if (supabaseError) {
        throw new Error(supabaseError.message);
      }

      if (!data.success) {
        throw new Error(data.error || 'Processing failed');
      }

      // Step 3: Complete
      setCurrentStep(3);
      setProgress(100);
      setCompletedFiles(files.length);
      
      toast({
        title: "Processing Complete",
        description: `Successfully processed ${data.processedFiles.length} images`,
      });

      // Complete the workflow
      setTimeout(() => {
        onComplete(data.processedFiles);
      }, 1000);

    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
      setError(errorMessage);
      console.error('Image processing error:', err);
      
      toast({
        title: "Processing Failed",
        description: errorMessage,
        variant: "destructive",
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
          <div className="grid grid-cols-4 gap-4">
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
            {files.map((file, index) => {
              const isProcessed = index < completedFiles;
              const isProcessing = index === completedFiles;
              
              return (
                <div key={index} className="relative group">
                  <div className={cn(
                    "aspect-square rounded-lg border-2 border-dashed flex items-center justify-center transition-smooth",
                    isProcessed && "border-success bg-success/5",
                    isProcessing && "border-electric bg-electric/5",
                    !isProcessed && !isProcessing && "border-muted bg-muted/30"
                  )}>
                    <div className="text-center space-y-2">
                      <ImageIcon className={cn(
                        "w-8 h-8 mx-auto",
                        isProcessed && "text-success",
                        isProcessing && "text-electric animate-pulse",
                        !isProcessed && !isProcessing && "text-muted-foreground"
                      )} />
                      <p className="text-xs text-muted-foreground truncate px-2">
                        {file.name}
                      </p>
                    </div>
                    
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