import React, { useState, useEffect } from 'react';
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [shadowedResults, setShadowedResults] = useState<Array<{ name: string; shadowedData: string }>>([]);
  const { toast } = useToast();
  
  // Shadow parameters
  const [azimuth, setAzimuth] = useState(0);
  const [elevation, setElevation] = useState(90);
  const [spread, setSpread] = useState(5);
  
  useEffect(() => {
    if (images.length > 0) {
      setPreviewBefore(images[0].data);
    }
  }, [images]);

  // Calculate CSS drop-shadow filter based on parameters
  const getDropShadowFilter = () => {
    // Convert azimuth (0-360°) and elevation (0-90°) to x,y offsets
    const azimuthRad = (azimuth * Math.PI) / 180;
    const elevationFactor = Math.cos((elevation * Math.PI) / 180);
    
    // Calculate shadow offset
    const offsetX = Math.cos(azimuthRad) * elevationFactor * 20;
    const offsetY = Math.sin(azimuthRad) * elevationFactor * 20;
    
    // Spread affects blur radius
    const blur = spread * 0.5;
    
    // Create CSS drop-shadow filter
    return `drop-shadow(${offsetX}px ${offsetY}px ${blur}px rgba(0, 0, 0, 0.5))`;
  };

  const generateShadows = async () => {
    setIsProcessing(true);
    setProgress(0);

    try {
      console.log(`Starting shadow generation for ${images.length} images with params: azimuth=${azimuth}, elevation=${elevation}, spread=${spread}`);

      const { data, error } = await supabase.functions.invoke('add-drop-shadow', {
        body: { 
          images,
          azimuth,
          elevation,
          spread
        }
      });

      if (error) throw error;

      if (data?.images) {
        const shadowedImages = data.images;
        
        // Show preview of first result
        if (shadowedImages.length > 0 && shadowedImages[0].shadowedData) {
          setPreviewAfter(shadowedImages[0].shadowedData);
        }

        // Store results for manual confirmation
        setShadowedResults(shadowedImages);

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
            title: "Shadows Generated",
            description: `Successfully added drop shadows to ${shadowedImages.length} images. Review the preview below.`,
          });
        }

        setProgress(100);
        setIsProcessing(false);
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
                <div className="space-y-6">
                  <div className="bg-muted/50 rounded-lg p-6 space-y-4">
                    <div className="flex items-start gap-3">
                      <Sparkles className="h-5 w-5 text-primary mt-1" />
                      <div className="flex-1">
                        <h3 className="font-semibold mb-4">Shadow Configuration</h3>
                        
                        {/* Azimuth Control */}
                        <div className="space-y-3 mb-4">
                          <Label htmlFor="azimuth" className="text-sm font-medium">
                            Azimuth: {azimuth}° (shadow direction)
                          </Label>
                          <div className="flex gap-3 items-center">
                            <Slider
                              id="azimuth"
                              min={0}
                              max={360}
                              step={1}
                              value={[azimuth]}
                              onValueChange={(value) => setAzimuth(value[0])}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={azimuth}
                              onChange={(e) => setAzimuth(Math.max(0, Math.min(360, parseInt(e.target.value) || 0)))}
                              className="w-20"
                              min={0}
                              max={360}
                            />
                          </div>
                        </div>

                        {/* Elevation Control */}
                        <div className="space-y-3 mb-4">
                          <Label htmlFor="elevation" className="text-sm font-medium">
                            Elevation: {elevation}° (light angle)
                          </Label>
                          <div className="flex gap-3 items-center">
                            <Slider
                              id="elevation"
                              min={0}
                              max={90}
                              step={1}
                              value={[elevation]}
                              onValueChange={(value) => setElevation(value[0])}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={elevation}
                              onChange={(e) => setElevation(Math.max(0, Math.min(90, parseInt(e.target.value) || 0)))}
                              className="w-20"
                              min={0}
                              max={90}
                            />
                          </div>
                        </div>

                        {/* Spread Control */}
                        <div className="space-y-3">
                          <Label htmlFor="spread" className="text-sm font-medium">
                            Spread: {spread} (shadow softness)
                          </Label>
                          <div className="flex gap-3 items-center">
                            <Slider
                              id="spread"
                              min={0}
                              max={100}
                              step={1}
                              value={[spread]}
                              onValueChange={(value) => setSpread(value[0])}
                              className="flex-1"
                            />
                            <Input
                              type="number"
                              value={spread}
                              onChange={(e) => setSpread(Math.max(0, Math.min(100, parseInt(e.target.value) || 0)))}
                              className="w-20"
                              min={0}
                              max={100}
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Live Preview */}
                  <div className="space-y-3">
                    <h4 className="text-sm font-medium text-center">Live Shadow Preview</h4>
                    <div className="grid md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground text-center">Original (Transparent)</p>
                        <div className="relative border rounded-lg overflow-hidden bg-checkered aspect-square flex items-center justify-center">
                          {previewBefore ? (
                            <img 
                              src={previewBefore} 
                              alt="Original subject" 
                              className="max-w-full max-h-full object-contain"
                            />
                          ) : (
                            <p className="text-muted-foreground text-sm">Loading...</p>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        <p className="text-xs text-muted-foreground text-center">With Drop Shadow (Live Preview)</p>
                        <div className="relative border-2 border-primary/50 rounded-lg overflow-hidden bg-checkered aspect-square flex items-center justify-center">
                          {previewBefore ? (
                            <>
                              <img 
                                src={previewBefore} 
                                alt="Shadow preview" 
                                className="max-w-full max-h-full object-contain"
                                style={{ filter: getDropShadowFilter() }}
                              />
                              {/* Debug info overlay */}
                              <div className="absolute bottom-2 right-2 text-xs bg-black/50 text-white px-2 py-1 rounded">
                                Az:{azimuth}° El:{elevation}° Sp:{spread}
                              </div>
                            </>
                          ) : (
                            <p className="text-muted-foreground text-sm">Loading...</p>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground text-center">
                      Adjust the sliders above to see the shadow update in real-time. Click "Generate Shadows" to apply the exact effect using Cloudinary.
                    </p>
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
              <div className="space-y-6">
                <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4 text-center">
                  <p className="text-sm text-green-800 dark:text-green-200 font-medium">
                    ✓ Shadows generated successfully! Review the preview below on transparent background.
                  </p>
                </div>

                <div className="grid md:grid-cols-2 gap-6">
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-center">Before (Transparent Background)</h4>
                    <div className="relative border-2 border-border rounded-lg overflow-hidden aspect-square flex items-center justify-center bg-checkered">
                      <img 
                        src={previewBefore} 
                        alt="Before shadow" 
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-center">After (With Drop Shadow)</h4>
                    <div className="relative border-2 border-primary/50 rounded-lg overflow-hidden aspect-square flex items-center justify-center bg-checkered">
                      <img 
                        src={previewAfter} 
                        alt="After shadow" 
                        className="max-w-full max-h-full object-contain"
                      />
                    </div>
                  </div>
                </div>

                <div className="bg-muted/50 rounded-lg p-4">
                  <p className="text-sm text-muted-foreground text-center">
                    The checkerboard pattern indicates transparent areas. The shadow is now part of the image.
                  </p>
                </div>

                <div className="flex gap-3">
                  <Button
                    onClick={() => onComplete(shadowedResults)}
                    className="flex-1"
                    size="lg"
                  >
                    Continue with Shadows
                  </Button>
                  <Button
                    variant="outline"
                    onClick={handleSkip}
                    size="lg"
                  >
                    Skip Shadows Instead
                  </Button>
                </div>
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
