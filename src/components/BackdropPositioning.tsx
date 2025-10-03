import React, { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Upload, Move, RotateCw, RotateCcw, ArrowRight, AlertCircle, Zap, Library, Loader2 } from "lucide-react";
import { uploadToCloudinary, renderComposite, MARBLE_STUDIO_GLOSS_V1 } from "@/lib/cloudinary-render";
import { supabase } from "@/integrations/supabase/client";
import { processAndCompressImage, getImageDimensions as getImageDimensionsFromFile } from "@/lib/image-resize-utils";
import { useToast } from "@/hooks/use-toast";
import { BackdropLibrary } from "@/components/BackdropLibrary";
import { rotateImageClockwise, rotateImageCounterClockwise } from "@/lib/image-rotation-utils";
import { findLowestAlphaPixel, getImageDimensions } from "@/lib/canvas-utils";

interface BackdropPositioningProps {
  cutoutImages: string[]; // Data URLs of cut-out subjects
  onPositioningComplete: (
    backdrop: string, 
    placement: { x: number; y: number; scale: number }, 
    addBlur: boolean, 
    rotatedSubjects?: string[],
    backdropCloudinaryId?: string,
    floorBaseline?: number // Y coordinate in pixels of the floor line
  ) => void;
  onBack: () => void;
}

export const BackdropPositioning: React.FC<BackdropPositioningProps> = ({
  cutoutImages,
  onPositioningComplete,
  onBack
}) => {
  const [backdrop, setBackdrop] = useState<string>("");
  const [backdropFile, setBackdropFile] = useState<File | null>(null);
  const [backdropAnalysis, setBackdropAnalysis] = useState<{
    needsOptimization: boolean;
    fileSize: number;
    dimensions: { width: number; height: number };
    finalSize?: number;
  } | null>(null);
  const [showOptimization, setShowOptimization] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [addBlur, setAddBlur] = useState(false);
  const [placement, setPlacement] = useState<{ x: number; y: number; scale: number }>({
    x: 0.5, // center
    y: 0.7, // slightly below center (typical product placement)
    scale: 0.5 // 50% of canvas width
  });
  const [rotatedSubjects, setRotatedSubjects] = useState<string[]>(cutoutImages);
  const [isRotating, setIsRotating] = useState(false);
  const [floorBaseline, setFloorBaseline] = useState<number>(0.7); // Default floor at 70% down the backdrop
  const [baselineNudge, setBaselineNudge] = useState<number>(0); // -40 to +40 px adjustment
  
  // Cloudinary preview state
  const [backdropCloudinaryId, setBackdropCloudinaryId] = useState<string>("");
  const [subjectCloudinaryId, setSubjectCloudinaryId] = useState<string>("");
  const [previewUrl, setPreviewUrl] = useState<string>("");
  const [isGeneratingPreview, setIsGeneratingPreview] = useState(false);
  
  const previewRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const updateTimerRef = useRef<NodeJS.Timeout | null>(null);
  const { toast } = useToast();

  const firstSubject = rotatedSubjects[0]; // Use first rotated image for positioning

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleOptimizeBackdrop = async () => {
    if (!backdropFile || !backdropAnalysis) return;
    
    setIsOptimizing(true);
    try {
      // Resize image to max 2048px while maintaining aspect ratio
      const optimizedFile = await processAndCompressImage(backdropFile);
      
      // Update analysis with final size
      setBackdropAnalysis(prev => prev ? {
        ...prev,
        finalSize: optimizedFile.size
      } : null);
      
      // Load the optimized image
      const reader = new FileReader();
      reader.onload = async (e) => {
        if (e.target?.result) {
          const backdropData = e.target.result as string;
          setBackdrop(backdropData);
          setShowOptimization(false);
          
          const sizeBefore = (backdropAnalysis.fileSize / 1024 / 1024).toFixed(1);
          const sizeAfter = (optimizedFile.size / 1024 / 1024).toFixed(1);
          
          toast({
            title: "Backdrop Optimized",
            description: `Size reduced from ${sizeBefore}MB to ${sizeAfter}MB`,
          });
          
          // Upload to Cloudinary immediately
          await uploadBackdropToCloudinary(backdropData);
        }
      };
      reader.readAsDataURL(optimizedFile);
    } catch (error) {
      console.error('Error optimizing backdrop:', error);
      toast({
        title: "Optimization Failed",
        description: "Could not optimize backdrop. Using original image.",
        variant: "destructive"
      });
      
      // Fallback to original file
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setBackdrop(e.target.result as string);
          setShowOptimization(false);
        }
      };
      reader.readAsDataURL(backdropFile);
    }
    setIsOptimizing(false);
  };

  const handleSkipOptimization = () => {
    if (!backdropFile) return;
    
    // Use original file without optimization
    const reader = new FileReader();
    reader.onload = async (e) => {
      if (e.target?.result) {
        const backdropData = e.target.result as string;
        setBackdrop(backdropData);
        setShowOptimization(false);
        
        // Upload to Cloudinary immediately
        await uploadBackdropToCloudinary(backdropData);
      }
    };
    reader.readAsDataURL(backdropFile);
  };
  
  const uploadBackdropToCloudinary = async (backdropData: string) => {
    try {
      setIsOptimizing(true);
      toast({
        title: "Uploading backdrop",
        description: "Preparing live preview..."
      });
      
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || 'anonymous';
      
      const backdropUpload = await uploadToCloudinary(backdropData, 'backdrop', userId);
      setBackdropCloudinaryId(backdropUpload.public_id);
      
      toast({
        title: "Backdrop ready",
        description: "Loading live preview..."
      });
    } catch (error) {
      console.error('Failed to upload backdrop:', error);
      toast({
        title: "Upload Failed",
        description: error instanceof Error ? error.message : "Failed to upload backdrop",
        variant: "destructive"
      });
    } finally {
      setIsOptimizing(false);
    }
  };
  
  const uploadSubjectToCloudinary = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || 'anonymous';
      
      const subjectUpload = await uploadToCloudinary(firstSubject, 'bag', userId);
      setSubjectCloudinaryId(subjectUpload.public_id);
    } catch (error) {
      console.error('Failed to upload subject:', error);
      toast({
        title: "Upload Failed",
        description: "Failed to upload product image",
        variant: "destructive"
      });
    }
  };
  
  const generateCloudinaryPreview = async () => {
    if (!backdropCloudinaryId || !subjectCloudinaryId) return;
    
    try {
      setIsGeneratingPreview(true);
      
      // Get backdrop dimensions for baseline calculation
      const backdropDims = await getImageDimensions(backdrop);
      const floorBaselinePx = Math.round((floorBaseline * backdropDims.height) + baselineNudge);
      
      // Call render-composite with current placement
      const renderResult = await renderComposite({
        bag_public_id: subjectCloudinaryId,
        backdrop_public_id: backdropCloudinaryId,
        canvas: MARBLE_STUDIO_GLOSS_V1.canvas!,
        placement: {
          mode: MARBLE_STUDIO_GLOSS_V1.placement!.mode,
          x: placement.x,
          y: placement.y,
          y_baseline_px: floorBaselinePx,
          rotation_deg: MARBLE_STUDIO_GLOSS_V1.placement!.rotation_deg,
          scale: placement.scale
        },
        shadow: {
          contact: { opacity: 0, radius_px: 0, offset_y_px: 0 },
          ground: { opacity: 0, radius_px: 0, elongation_y: 0 }
        },
        reflection: { enabled: false, opacity: 0, fade_pct: 0, blur_px: 0, offset_y_px: 0 },
        backdrop_fx: { wall_blur_px: addBlur ? 20 : 0 },
        safeguards: MARBLE_STUDIO_GLOSS_V1.safeguards!
      });
      
      setPreviewUrl(renderResult.url);
    } catch (error) {
      console.error('Failed to generate preview:', error);
    } finally {
      setIsGeneratingPreview(false);
    }
  };

  // Generate Cloudinary preview when placement changes
  useEffect(() => {
    if (backdropCloudinaryId && subjectCloudinaryId) {
      // Debounce preview updates
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
      
      updateTimerRef.current = setTimeout(() => {
        generateCloudinaryPreview();
      }, 300);
    }
    
    return () => {
      if (updateTimerRef.current) {
        clearTimeout(updateTimerRef.current);
      }
    };
  }, [backdropCloudinaryId, subjectCloudinaryId, placement, floorBaseline, baselineNudge, addBlur]);
  
  // Upload subject to Cloudinary when backdrop is uploaded
  useEffect(() => {
    if (backdropCloudinaryId && firstSubject && !subjectCloudinaryId) {
      uploadSubjectToCloudinary();
    }
  }, [backdropCloudinaryId, firstSubject]);

  const handleBackdropUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setBackdropFile(file);
      
      try {
        // Get image dimensions
        const dimensions = await getImageDimensionsFromFile(file);
        const fileSize = file.size;
        
        // Check if optimization is needed (>5MB or >2048px in any dimension)
        const needsOptimization = fileSize > 5 * 1024 * 1024 || dimensions.width > 2048 || dimensions.height > 2048;
        
        const analysis = {
          needsOptimization,
          fileSize,
          dimensions
        };
        
        setBackdropAnalysis(analysis);
        
        if (needsOptimization) {
          setShowOptimization(true);
        } else {
          // File is fine, load it directly
          const reader = new FileReader();
          reader.onload = async (e) => {
            if (e.target?.result) {
              const backdropData = e.target.result as string;
              setBackdrop(backdropData);
              
              // Upload to Cloudinary immediately
              await uploadBackdropToCloudinary(backdropData);
            }
          };
          reader.readAsDataURL(file);
        }
      } catch (error) {
        console.error('Error analyzing backdrop:', error);
        toast({
          title: "Error",
          description: "Failed to analyze backdrop image. Please try a different file.",
          variant: "destructive"
        });
      }
    }
  };

  const handlePreviewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    const preview = previewRef.current;
    if (!preview || !previewUrl) return;

    const rect = preview.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;

    setPlacement(prev => ({
      ...prev,
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    }));
  };

  const handleScaleChange = (value: number[]) => {
    setPlacement(prev => ({ ...prev, scale: value[0] }));
  };

  const rotateSubject = async (direction: 'clockwise' | 'counterclockwise') => {
    setIsRotating(true);
    try {
      // Rotate ALL subjects, not just the first one
      const rotatedDataPromises = rotatedSubjects.map(async (subjectData) => {
        return direction === 'clockwise' 
          ? await rotateImageClockwise(subjectData)
          : await rotateImageCounterClockwise(subjectData);
      });

      const allRotatedSubjects = await Promise.all(rotatedDataPromises);
      setRotatedSubjects(allRotatedSubjects);
      
      // Re-upload first subject to Cloudinary
      const { data: { user } } = await supabase.auth.getUser();
      const userId = user?.id || 'anonymous';
      const subjectUpload = await uploadToCloudinary(allRotatedSubjects[0], 'bag', userId);
      setSubjectCloudinaryId(subjectUpload.public_id);
      
      toast({
        title: "All subjects rotated",
        description: `All ${rotatedSubjects.length} subjects rotated ${direction}`,
      });
    } catch (error) {
      console.error('Error rotating subjects:', error);
      toast({
        title: "Rotation failed",
        description: "Failed to rotate the subjects. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsRotating(false);
    }
  };

  const handleContinue = async () => {
    if (!backdrop || !backdropCloudinaryId) return;
    
    try {
      // Calculate floor baseline in pixels (from backdrop dimensions)
      const backdropDims = await getImageDimensions(backdrop);
      const floorBaselinePx = Math.round((floorBaseline * backdropDims.height) + baselineNudge);
      
      console.log('🎯 Final placement values:', {
        x: placement.x,
        y: placement.y,
        scale: placement.scale,
        floorBaseline: floorBaselinePx,
        backdropHeight: backdropDims.height
      });

      toast({
        title: "Positioning complete",
        description: "Ready to render with shadows and reflections"
      });

      // Pass backdrop data URL, placement, Cloudinary ID, and floor baseline to parent
      onPositioningComplete(
        backdrop, 
        placement, 
        addBlur, 
        rotatedSubjects, 
        backdropCloudinaryId,
        floorBaselinePx
      );
    } catch (error) {
      console.error('Failed to continue:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to continue",
        variant: "destructive"
      });
    }
  };

  // Show optimization dialog if needed
  if (showOptimization && backdropAnalysis) {
    return (
      <div className="container mx-auto px-4 py-8">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-8">
            <h1 className="text-3xl font-bold mb-2">Backdrop Analysis</h1>
            <p className="text-muted-foreground">
              Your backdrop image needs optimization for best performance
            </p>
          </div>

          <Card className="max-w-2xl mx-auto">
            <CardHeader className="text-center">
              <div className="flex items-center justify-center mb-4">
                <AlertCircle className="h-12 w-12 text-yellow-500" />
              </div>
              <CardTitle className="text-xl">Large Backdrop Detected</CardTitle>
            </CardHeader>
            
            <CardContent className="space-y-6">
              <div className="bg-muted/50 rounded-lg p-4 space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">File Size:</span>
                  <Badge variant={backdropAnalysis.fileSize > 5 * 1024 * 1024 ? "destructive" : "secondary"}>
                    {formatFileSize(backdropAnalysis.fileSize)}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Dimensions:</span>
                  <Badge variant={Math.max(backdropAnalysis.dimensions.width, backdropAnalysis.dimensions.height) > 2048 ? "destructive" : "secondary"}>
                    {backdropAnalysis.dimensions.width}×{backdropAnalysis.dimensions.height}px
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Recommended Max:</span>
                  <Badge variant="outline">2048×2048px</Badge>
                </div>
                {backdropAnalysis.finalSize && (
                  <div className="flex justify-between items-center">
                    <span className="text-sm font-medium">Optimized Size:</span>
                    <Badge variant="secondary">
                      {formatFileSize(backdropAnalysis.finalSize)}
                    </Badge>
                  </div>
                )}
              </div>

              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
                <div className="flex items-start gap-3">
                  <Zap className="h-5 w-5 text-blue-500 mt-0.5" />
                  <div>
                    <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                      Recommended: Optimize Backdrop
                    </h4>
                    <p className="text-sm text-blue-700 dark:text-blue-200">
                      Large backdrops can cause processing failures. We'll resize to 2048px max dimension and maintain aspect ratio.
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-3">
                <Button 
                  onClick={handleOptimizeBackdrop} 
                  className="flex-1"
                  disabled={isOptimizing}
                >
                  <Zap className="h-4 w-4 mr-2" />
                  {isOptimizing ? 'Optimizing...' : 'Optimize Backdrop'}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleSkipOptimization}
                  disabled={isOptimizing}
                >
                  Use Original
                </Button>
              </div>

              <p className="text-xs text-muted-foreground text-center">
                Optimization resizes to 2048px max dimension and compresses for Edge Function compatibility
              </p>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-secondary/20 p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="text-center space-y-4">
          <div className="flex items-center justify-center gap-2 text-primary">
            <Move className="h-8 w-8" />
            <h1 className="text-3xl font-bold">Backdrop & Positioning</h1>
          </div>
          <p className="text-muted-foreground max-w-2xl mx-auto">
            Upload a backdrop and position your product. This placement will guide the AI for all your images.
          </p>
        </div>

        <div className="grid lg:grid-cols-2 gap-6">
          {/* Left Panel - Controls */}
          <Card>
            <CardHeader>
              <CardTitle>Step 5: Backdrop Setup</CardTitle>
              <CardDescription>
                Configure backdrop and position your first product
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Backdrop Selection */}
              <div className="space-y-2">
                <Label>Backdrop Image *</Label>
                <Tabs defaultValue="upload" className="w-full">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="upload">Upload New</TabsTrigger>
                    <TabsTrigger value="library">From Library</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="upload" className="mt-4">
                    <div 
                      className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-6 text-center cursor-pointer hover:border-primary/50 transition-colors"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
                      <p className="text-sm text-muted-foreground">
                        {backdrop ? "Backdrop uploaded" : "Click to upload backdrop"}
                      </p>
                    </div>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleBackdropUpload}
                      className="hidden"
                    />
                  </TabsContent>
                  
                  <TabsContent value="library" className="mt-4">
                    <Card>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-base flex items-center gap-2">
                          <Library className="h-4 w-4" />
                          Your Backdrop Library
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <BackdropLibrary 
                          selectionMode={true}
                          onSelect={async (backdrop, imageUrl) => {
                            try {
                              // Convert signed URL to data URL for proper processing
                              const response = await fetch(imageUrl);
                              const blob = await response.blob();
                              const reader = new FileReader();
                              reader.onload = async (e) => {
                                if (e.target?.result) {
                                  const backdropData = e.target.result as string;
                                  setBackdrop(backdropData);
                                  setBackdropFile(null); // Clear file reference for library images
                                  toast({
                                    title: "Backdrop Selected",
                                    description: `Using "${backdrop.name}" from library`
                                  });
                                  
                                  // Upload to Cloudinary for live preview
                                  await uploadBackdropToCloudinary(backdropData);
                                }
                              };
                              reader.readAsDataURL(blob);
                            } catch (error) {
                              console.error('Error loading backdrop from library:', error);
                              toast({
                                title: "Error",
                                description: "Failed to load backdrop from library. Please try again.",
                                variant: "destructive"
                              });
                            }
                          }}
                        />
                      </CardContent>
                    </Card>
                  </TabsContent>
                </Tabs>
              </div>

              {/* Background Blur Option */}
              <div className="flex items-center space-x-2">
                <Checkbox
                  id="add-blur"
                  checked={addBlur}
                  onCheckedChange={(checked) => setAddBlur(checked === true)}
                />
                <Label htmlFor="add-blur">Add background blur (depth of field)</Label>
              </div>

              {/* Subject Rotation Controls */}
              {firstSubject && (
                <div className="space-y-3">
                  <Label>Subject Orientation</Label>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rotateSubject('counterclockwise')}
                      disabled={isRotating}
                      className="flex-1"
                    >
                      <RotateCcw className="h-4 w-4 mr-1" />
                      90° CCW
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => rotateSubject('clockwise')}
                      disabled={isRotating}
                      className="flex-1"
                    >
                      <RotateCw className="h-4 w-4 mr-1" />
                      90° CW
                    </Button>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Rotate all subjects before positioning on backdrop
                  </p>
                </div>
              )}

              {/* Positioning Controls */}
              {backdrop && firstSubject && (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>Product Size</Label>
                    <Slider
                      value={[placement.scale]}
                      onValueChange={handleScaleChange}
                      max={1.0}
                      min={0.1}
                      step={0.05}
                      className="w-full"
                    />
                    <div className="text-xs text-muted-foreground text-center">
                      {Math.round(placement.scale * 100)}% of backdrop width
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Floor Baseline (Y Position)</Label>
                    <Slider
                      value={[floorBaseline]}
                      onValueChange={(value) => setFloorBaseline(value[0])}
                      max={1.0}
                      min={0.0}
                      step={0.01}
                      className="w-full"
                    />
                    <div className="text-xs text-muted-foreground text-center">
                      Floor at {Math.round(floorBaseline * 100)}% down backdrop
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Baseline Nudge (Fine Adjustment)</Label>
                    <Slider
                      value={[baselineNudge]}
                      onValueChange={(value) => setBaselineNudge(value[0])}
                      max={40}
                      min={-40}
                      step={1}
                      className="w-full"
                    />
                    <div className="text-xs text-muted-foreground text-center">
                      {baselineNudge > 0 ? '+' : ''}{baselineNudge}px adjustment
                    </div>
                  </div>

                  <div className="bg-muted/50 p-3 rounded-lg">
                    <p className="text-sm font-medium mb-1">Positioning Instructions:</p>
                    <p className="text-xs text-muted-foreground">
                      Click and drag on the preview to position your product. Use the size slider to adjust scale. Floor baseline controls where shadows/reflections are anchored.
                    </p>
                  </div>
                </div>
              )}

              {/* Processing Info */}
              <div className="bg-primary/5 p-4 rounded-lg">
                <h4 className="font-medium mb-2">Processing Info:</h4>
                <div className="text-sm text-muted-foreground space-y-1">
                  <div>• Products to process: {cutoutImages.length}</div>
                  <div>• Backdrop: {backdrop ? "✓ Ready" : "⚠ Required"}</div>
                  <div>• Position: {backdrop ? "✓ Interactive" : "⚠ Upload backdrop first"}</div>
                  {backdropAnalysis?.finalSize && (
                    <div>• Final backdrop size: {formatFileSize(backdropAnalysis.finalSize)}</div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Right Panel - Preview */}
          <Card>
            <CardHeader>
              <CardTitle>Preview</CardTitle>
              <CardDescription>
                Drag to position, adjust size with slider
              </CardDescription>
            </CardHeader>
            <CardContent>
              {backdrop && firstSubject ? (
                <div className="space-y-4">
                  <div 
                    ref={previewRef}
                    className="relative flex justify-center items-center bg-muted/50 rounded-lg border-2 border-muted-foreground/10 overflow-hidden cursor-crosshair" 
                    style={{ minHeight: '400px' }}
                    onClick={handlePreviewClick}
                  >
                    {previewUrl ? (
                      <>
                        <img 
                          src={previewUrl} 
                          alt="Live Cloudinary Preview" 
                          className="max-w-full max-h-[500px] object-contain"
                        />
                        {isGeneratingPreview && (
                          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                            <Loader2 className="h-8 w-8 animate-spin" />
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="flex flex-col items-center justify-center p-8 text-center">
                        <Loader2 className="h-12 w-12 animate-spin mb-4 text-primary" />
                        <p className="text-sm text-muted-foreground">
                          Generating live Cloudinary preview...
                        </p>
                      </div>
                    )}
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground text-center">
                      Position: ({Math.round(placement.x * 100)}%, {Math.round(placement.y * 100)}%)
                    </div>
                    <div className="text-xs text-primary/70 text-center font-medium">
                      ✓ Live Cloudinary Preview - What you see is what you get
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-64 bg-muted/20 rounded-lg border-2 border-dashed">
                  <div className="text-center">
                    <RotateCw className="h-12 w-12 mx-auto mb-2 text-muted-foreground" />
                    <p className="text-muted-foreground">
                      Upload backdrop to see preview
                    </p>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex justify-center gap-4">
          <Button variant="outline" onClick={onBack}>
            Back to Masks
          </Button>
          <Button 
            onClick={handleContinue} 
            disabled={!backdrop || isOptimizing}
            className="min-w-[200px]"
          >
            {isOptimizing ? 'Uploading Backdrop...' : 'Continue to Rendering'}
            <ArrowRight className="ml-2 h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
};