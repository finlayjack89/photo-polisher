import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Loader2, Sparkles, SkipForward, ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ShadowGenerationStepProps {
  images: Array<{
    name: string;
    data: string;
  }>;
  onComplete: (shadowedImages: Array<{ name: string; shadowedData: string }>) => void;
  onSkip: () => void;
  onBack: () => void;
}

export const ShadowGenerationStep: React.FC<ShadowGenerationStepProps> = ({
  images,
  onComplete,
  onSkip,
  onBack
}) => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentImage, setCurrentImage] = useState(0);
  const [previewBefore, setPreviewBefore] = useState<string>('');
  const [previewAfter, setPreviewAfter] = useState<string>('');
  const { toast } = useToast();

  useEffect(() => {
    if (images.length > 0) {
      setPreviewBefore(images[0].data);
    }
  }, [images]);

  const generateShadows = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      console.log(`Starting shadow generation for ${images.length} images`);

      const { data, error } = await supabase.functions.invoke('add-drop-shadow', {
        body: { images }
      });

      if (error) throw error;

      if (data?.images) {
        const shadowedImages = data.images;
        
        // Show preview of first result
        if (shadowedImages.length > 0 && shadowedImages[0].shadowedData) {
          setPreviewAfter(shadowedImages[0].shadowedData);
        }

        // Check for any errors
        const failedImages = shadowedImages.filter((img: any) => img.error);
        if (failedImages.length > 0) {
          console.warn('Some images failed shadow generation:', failedImages);
          toast({
            title: "Partial Success",
            description: `${shadowedImages.length - failedImages.length}/${shadowedImages.length} images processed successfully`,
            variant: "default"
          });
        } else {
          toast({
            title: "Shadows Added",
            description: `Successfully added drop shadows to ${shadowedImages.length} images`,
          });
        }

        setProgress(100);
        setTimeout(() => {
          onComplete(shadowedImages);
        }, 500);
      } else {
        throw new Error('No data returned from shadow generation');
      }

    } catch (error) {
      console.error('Shadow generation error:', error);
      toast({
        title: "Shadow Generation Failed",
        description: error instanceof Error ? error.message : 'Failed to add shadows. You can skip this step.',
        variant: "destructive"
      });
      setIsProcessing(false);
    }
  };

  const handleSkip = () => {
    toast({
      title: "Shadows Skipped",
      description: "Continuing without drop shadows",
    });
    onSkip();
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 p-4">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-primary">
            <Sparkles className="h-8 w-8" />
            <h1 className="text-3xl font-bold">Drop Shadow Generation</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Add professional drop shadows to your subjects using Cloudinary
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Step 4: Add Drop Shadows</CardTitle>
            <CardDescription>
              Apply realistic shadows to make your products stand out (optional)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {!isProcessing && !previewAfter && (
              <>
                <div className="bg-muted/50 rounded-lg p-6 space-y-4">
                  <div className="flex items-start gap-3">
                    <Sparkles className="h-5 w-5 text-primary mt-1" />
                    <div>
                      <h3 className="font-semibold mb-2">Shadow Configuration</h3>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• <strong>Azimuth:</strong> 0° (shadow directly behind)</li>
                        <li>• <strong>Elevation:</strong> 90° (light from above)</li>
                        <li>• <strong>Spread:</strong> 5 (soft shadow)</li>
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Preview (First Image)</h4>
                    <div className="relative border rounded-lg overflow-hidden bg-muted/20 aspect-square flex items-center justify-center">
                      {previewBefore ? (
                        <img 
                          src={previewBefore} 
                          alt="Subject preview" 
                          className="max-w-full max-h-full object-contain"
                        />
                      ) : (
                        <p className="text-muted-foreground text-sm">No preview available</p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={generateShadows}
                    className="flex-1"
                    size="lg"
                  >
                    <Sparkles className="h-4 w-4 mr-2" />
                    Generate Shadows ({images.length} {images.length === 1 ? 'image' : 'images'})
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSkip}
                    size="lg"
                  >
                    <SkipForward className="h-4 w-4 mr-2" />
                    Skip
                  </Button>
                </div>
              </>
            )}

            {isProcessing && (
              <div className="space-y-4">
                <div className="flex items-center justify-center gap-3 py-8">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <div className="text-center">
                    <p className="text-lg font-medium">Generating shadows...</p>
                    <p className="text-sm text-muted-foreground">
                      Processing {images.length} {images.length === 1 ? 'image' : 'images'}
                    </p>
                  </div>
                </div>
                <Progress value={progress} className="w-full" />
              </div>
            )}

            {previewAfter && !isProcessing && (
              <div className="space-y-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">Before</h4>
                    <div className="relative border rounded-lg overflow-hidden bg-muted/20 aspect-square flex items-center justify-center">
                      <img 
                        src={previewBefore} 
                        alt="Before shadow" 
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium">After (with shadow)</h4>
                    <div className="relative border rounded-lg overflow-hidden bg-muted/20 aspect-square flex items-center justify-center">
                      <img 
                        src={previewAfter} 
                        alt="After shadow" 
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </div>
                </div>
                <p className="text-sm text-center text-muted-foreground">
                  ✓ Shadows added successfully! Continuing to next step...
                </p>
              </div>
            )}

            <div className="pt-4 border-t">
              <Button variant="ghost" onClick={onBack} disabled={isProcessing}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};
