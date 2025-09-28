import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, ArrowLeft, ArrowRight, Loader2, Scissors, Download } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface BackgroundRemovalStepProps {
  files: File[];
  onContinue: (backgroundRemovedImages: Array<{
    name: string;
    originalData: string;
    backgroundRemovedData: string;
    size: number;
    originalSize?: number;
  }>) => void;
  onBack: () => void;
  isProcessing?: boolean;
}

interface ProcessedImage {
  name: string;
  originalData: string;
  backgroundRemovedData: string;
  size: number;
  originalSize?: number;
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
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleRemoveBackgrounds = async () => {
    setIsProcessingLocal(true);
    setProgress(0);
    setError(null); // Clear previous errors
    setCurrentProcessingStep('Converting images...');

    try {
      // Convert files to base64 and store original sizes
      const imageData = await Promise.all(
        files.map(async (file) => {
          const reader = new FileReader();
          return new Promise<{ data: string; name: string; originalSize: number }>((resolve) => {
            reader.onload = () => resolve({
              data: reader.result as string,
              name: file.name,
              originalSize: file.size
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
          body: { images: batch.map(img => ({ data: img.data, name: img.name })) }
        });

        if (error) {
          console.error('Supabase function error:', error);
          throw new Error(`Background removal failed: ${error.message || 'Unknown error occurred'}`);
        }

        if (!result) {
          throw new Error('No response received from background removal service');
        }

        if (result.error) {
          console.error('Function returned error:', result.error);
          throw new Error(`Background removal error: ${result.error}`);
        }

        if (!result.results || !Array.isArray(result.results)) {
          console.error('Invalid response format:', result);
          throw new Error('Invalid response format from background removal service');
        }

        // Check for any failed images in the batch
        const failed = result.results.filter((res: any) => res.error);
        if (failed.length > 0) {
          console.warn('Some images failed:', failed);
          toast({
            title: "Partial Processing",
            description: `${failed.length} out of ${batch.length} images failed to process in this batch`,
            variant: "destructive",
          });
        }

        // Add original size to successful results only
        const successfulResults = result.results.filter((res: any) => !res.error);
        const resultsWithOriginalSize = successfulResults.map((res: any, index: number) => {
          const originalIndex = result.results.indexOf(res);
          return {
            ...res,
            originalSize: batch[originalIndex]?.originalSize || 0
          };
        });
        
        allResults.push(...resultsWithOriginalSize);
      }

      if (allResults.length === 0) {
        throw new Error('All images failed to process. Please try again or check your image formats.');
      }

      setProgress(100);
      setCurrentProcessingStep('Complete!');
      
      setProcessedImages(allResults);

      if (allResults.length < imageData.length) {
        toast({
          title: "Partial Success",
          description: `${allResults.length} out of ${imageData.length} images processed successfully`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Success",
          description: `All ${allResults.length} images processed successfully`,
        });
      }
      
    } catch (error) {
      console.error('Error removing backgrounds:', error);
      const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
      
      setError(errorMessage);
      
      toast({
        title: "Background Removal Failed",
        description: errorMessage,
        variant: "destructive",
      });

      // Reset progress on error
      setProgress(0);
      setCurrentProcessingStep('');
    } finally {
      setIsProcessingLocal(false);
    }
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
                    
                    {/* Size and Quality Metrics */}
                    <div className="space-y-2 text-xs">
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Original Size:</span>
                        <Badge variant="outline">
                          {image.originalSize ? formatFileSize(image.originalSize) : 'N/A'}
                        </Badge>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-muted-foreground">Processed Size:</span>
                        <Badge variant="outline">
                          {formatFileSize(image.size)}
                        </Badge>
                      </div>
                      {image.originalSize && (
                        <>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Size Change:</span>
                            <Badge 
                              variant={image.size > image.originalSize ? "secondary" : "default"}
                              className="text-xs"
                            >
                              {image.size > image.originalSize ? '+' : ''}
                              {Math.round(((image.size - image.originalSize) / image.originalSize) * 100)}%
                            </Badge>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Quality Retention:</span>
                            <Badge 
                              variant="default"
                              className="text-xs"
                            >
                              ~95%
                            </Badge>
                          </div>
                        </>
                      )}
                      <Badge variant="outline" className="text-xs w-full justify-center">
                        PNG with Transparency
                      </Badge>
                    </div>
                    
                    {/* Download Button */}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        const link = document.createElement('a');
                        link.href = image.backgroundRemovedData;
                        link.download = `background_removed_${image.name}`;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                      }}
                      className="w-full mt-2"
                    >
                      <Download className="h-3 w-3 mr-1" />
                      Download
                    </Button>
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
                  <Card key={index} className="p-3">
                    <div className="space-y-3">
                      <img
                        src={URL.createObjectURL(file)}
                        alt={file.name}
                        className="w-full h-32 object-cover rounded border"
                      />
                      <div className="space-y-2">
                        <p className="text-xs font-medium truncate">
                          {file.name}
                        </p>
                        
                        {/* File Size Information */}
                        <div className="space-y-1">
                          <div className="flex justify-between items-center text-xs">
                            <span className="text-muted-foreground">Size:</span>
                            <Badge variant="outline" className="text-xs">
                              {formatFileSize(file.size)}
                            </Badge>
                          </div>
                          <Badge variant="outline" className="text-xs w-full justify-center">
                            Post-Compression
                          </Badge>
                        </div>
                        
                        {/* Download Button */}
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            const url = URL.createObjectURL(file);
                            const link = document.createElement('a');
                            link.href = url;
                            link.download = file.name;
                            document.body.appendChild(link);
                            link.click();
                            document.body.removeChild(link);
                            URL.revokeObjectURL(url);
                          }}
                          className="w-full"
                        >
                          <Download className="h-3 w-3 mr-1" />
                          Download
                        </Button>
                      </div>
                    </div>
                  </Card>
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

         {error && (
           <Alert variant="destructive">
             <AlertCircle className="h-4 w-4" />
             <AlertDescription>
               {error}
             </AlertDescription>
           </Alert>
         )}

         <div className="flex justify-center gap-4">
           <Button variant="outline" onClick={onBack}>
             Back
           </Button>
           <Button 
             onClick={handleRemoveBackgrounds}
             className="min-w-[200px]"
             disabled={isProcessingLocal}
           >
             {isProcessingLocal ? (
               <>
                 <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                 Processing...
               </>
             ) : error ? (
               <>
                 <Scissors className="mr-2 h-4 w-4" />
                 Retry Background Removal
               </>
             ) : (
               <>
                 <Scissors className="mr-2 h-4 w-4" />
                 Remove Backgrounds
               </>
             )}
           </Button>
         </div>
      </div>
    </div>
  );
};