import React, { useState } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, Download, Scissors, ArrowRight } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";

interface BackgroundRemovalStepProps {
  files: File[];
  onContinue: (backgroundRemovedImages: Array<{
    name: string;
    originalData: string;
    backgroundRemovedData: string;
    size: number;
  }>) => void;
  onBack: () => void;
  isProcessing?: boolean;
}

interface ProcessedImage {
  name: string;
  originalData: string;
  backgroundRemovedData: string;
  size: number;
}

export const BackgroundRemovalStep: React.FC<BackgroundRemovalStepProps> = ({
  files,
  onContinue,
  onBack,
  isProcessing = false
}) => {
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>([]);
  const [isProcessingLocal, setIsProcessingLocal] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentProcessingStep, setCurrentProcessingStep] = useState('');

  const handleRemoveBackgrounds = async () => {
    setIsProcessingLocal(true);
    setProgress(0);
    setCurrentProcessingStep('Converting images...');

    try {
      // Convert files to base64
      const imageData = await Promise.all(
        files.map(async (file) => {
          const reader = new FileReader();
          return new Promise<{ data: string; name: string }>((resolve) => {
            reader.onload = () => resolve({
              data: reader.result as string,
              name: file.name
            });
            reader.readAsDataURL(file);
          });
        })
      );

      setProgress(20);
      setCurrentProcessingStep('Removing backgrounds with AI...');

      // Process images in batches of 3 to avoid CPU timeouts
      const BATCH_SIZE = 3;
      const allResults: ProcessedImage[] = [];
      
      for (let i = 0; i < imageData.length; i += BATCH_SIZE) {
        const batch = imageData.slice(i, i + BATCH_SIZE);
        const batchProgress = ((i / imageData.length) * 80) + 20; // 20-100% range
        
        setCurrentProcessingStep(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1} of ${Math.ceil(imageData.length / BATCH_SIZE)}...`);
        setProgress(batchProgress);

        const { data: result, error } = await supabase.functions.invoke('remove-backgrounds', {
          body: { images: batch }
        });

        if (error) {
          throw new Error(error.message);
        }

        if (result?.results) {
          allResults.push(...result.results);
        }
      }

      setProgress(100);
      setCurrentProcessingStep('Complete!');
      
      setProcessedImages(allResults);
      
    } catch (error) {
      console.error('Error removing backgrounds:', error);
      alert(`Error: ${error.message}`);
    } finally {
      setIsProcessingLocal(false);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
    return `${Math.round(bytes / (1024 * 1024))} MB`;
  };

  const shouldCompress = (size: number) => size > 5 * 1024 * 1024; // 5MB threshold
  const largeImages = processedImages.filter(img => shouldCompress(img.size));

  if (isProcessingLocal || isProcessing) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <Scissors className="h-12 w-12 mx-auto text-primary mb-4" />
            <CardTitle>Removing Backgrounds</CardTitle>
            <CardDescription>AI is removing backgrounds from your images...</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Progress value={progress} className="w-full" />
            <p className="text-sm text-muted-foreground text-center">
              {currentProcessingStep}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (processedImages.length > 0) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 p-4">
        <div className="max-w-6xl mx-auto space-y-6">
          <div className="text-center space-y-4">
            <div className="flex items-center justify-center gap-2 text-primary">
              <Scissors className="h-8 w-8" />
              <h1 className="text-3xl font-bold">Background Removal Complete</h1>
            </div>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              Your images have been processed. Review the results below.
            </p>
          </div>

          {largeImages.length > 0 && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                {largeImages.length} image(s) are larger than 5MB and may need compression for optimal AI processing.
                Large images can cause processing delays or failures.
              </AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {processedImages.map((image, index) => (
              <Card key={index}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm truncate">{image.name}</CardTitle>
                    <Badge variant={shouldCompress(image.size) ? "destructive" : "secondary"}>
                      {formatFileSize(image.size)}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Original</p>
                        <img
                          src={image.originalData}
                          alt={`Original ${image.name}`}
                          className="w-full h-24 object-cover rounded border"
                        />
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Background Removed</p>
                        <div className="w-full h-24 rounded border bg-checkered">
                          <img
                            src={image.backgroundRemovedData}
                            alt={`Processed ${image.name}`}
                            className="w-full h-full object-cover rounded"
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex justify-center gap-4">
            <Button variant="outline" onClick={onBack}>
              Back
            </Button>
            <Button 
              onClick={() => onContinue(processedImages)}
              className="min-w-[200px]"
            >
              Continue to Backdrop Selection
              <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-primary">
            <Scissors className="h-8 w-8" />
            <h1 className="text-3xl font-bold">Background Removal</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Remove backgrounds from your product images using AI. This will create clean cutouts
            ready for compositing on new backdrops.
          </p>
        </div>

        <Card className="mx-auto max-w-2xl">
          <CardHeader>
            <CardTitle>Images to Process</CardTitle>
            <CardDescription>
              The following images will have their backgrounds removed
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {files.map((file, index) => (
                  <div key={index} className="space-y-2">
                    <img
                      src={URL.createObjectURL(file)}
                      alt={file.name}
                      className="w-full h-32 object-cover rounded border"
                    />
                    <p className="text-xs text-muted-foreground truncate">
                      {file.name}
                    </p>
                  </div>
                ))}
              </div>
              
              <div className="bg-muted/50 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Processing Details:</h4>
                <ul className="text-sm text-muted-foreground space-y-1">
                  <li>• AI will identify and preserve your product</li>
                  <li>• Background will be completely removed</li>
                  <li>• Results will be in PNG format with transparency</li>
                  <li>• Processing time: ~10-30 seconds per image</li>
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-center gap-4">
          <Button variant="outline" onClick={onBack}>
            Back
          </Button>
          <Button 
            onClick={handleRemoveBackgrounds}
            className="min-w-[200px]"
          >
            <Scissors className="mr-2 h-4 w-4" />
            Remove Backgrounds
          </Button>
        </div>
      </div>
    </div>
  );
};