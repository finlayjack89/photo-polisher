import React, { useState } from "react";
import { Download, RotateCcw, Zap, Image as ImageIcon, ArrowLeft, ExternalLink, Edit3, Save, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Slider } from "@/components/ui/slider";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import JSZip from "jszip";

interface ProcessedImage {
  name: string;
  originalData?: string; // base64
  processedData?: string; // base64  
  finalizedData?: string; // V5 architecture
  size?: number;
  originalSize?: number;
  compressionRatio?: string;
  qualityPercentage?: number;
  retryStatus?: 'idle' | 'processing' | 'completed' | 'error';
  retryEnhancedData?: string;
  customFilename?: string;
}

interface GalleryPreviewProps {
  results: ProcessedImage[];
  onBack: () => void;
  title?: string;
}

export const GalleryPreview = ({ results, onBack, title = "Processing Complete!" }: GalleryPreviewProps) => {
  const [selectedView, setSelectedView] = useState<'grid' | 'comparison'>('grid');
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaledImages, setUpscaledImages] = useState<ProcessedImage[]>([]);
  const [isEditingNames, setIsEditingNames] = useState(false);
  const [temperature, setTemperature] = useState<number>(0.7);
  const [processedImages, setProcessedImages] = useState<ProcessedImage[]>(results);
  const { toast } = useToast();

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Use results from V5 architecture or upscaled images
  const displayImages = upscaledImages.length > 0 ? upscaledImages : processedImages;

  const handleUpscaleAndCompress = async () => {
    setIsUpscaling(true);
    try {
      // Prepare data for upscaling from V5 results
      const upscaleData = results.map(img => ({
        name: img.name,
        data: (img.finalizedData || img.processedData || '').replace(/^data:image\/[a-z]+;base64,/, ''),
        size: img.size || 0,
        type: 'image/png'
      }));

      // Process images in batches to avoid timeouts
      const BATCH_SIZE = 2;
      const allUpscaledFiles: any[] = [];
      
      for (let i = 0; i < upscaleData.length; i += BATCH_SIZE) {
        const batch = upscaleData.slice(i, i + BATCH_SIZE);
        
        const { data: upscaleResult, error: upscaleError } = await supabase.functions.invoke('upscale-images', {
          body: { files: batch }
        });

        if (upscaleError) throw upscaleError;
        
        if (upscaleResult?.upscaledFiles) {
          allUpscaledFiles.push(...upscaleResult.upscaledFiles);
        }
      }

      // Compress the upscaled images
      const allCompressedFiles: any[] = [];
      
      for (let i = 0; i < allUpscaledFiles.length; i += BATCH_SIZE) {
        const batch = allUpscaledFiles.slice(i, i + BATCH_SIZE);
        
        const { data: compressResult, error: compressError } = await supabase.functions.invoke('compress-images', {
          body: { files: batch }
        });

        if (compressError) throw compressError;
        
        if (compressResult?.compressedFiles) {
          allCompressedFiles.push(...compressResult.compressedFiles);
        }
      }

      // Update displayed images with upscaled versions
      const enhanced = allCompressedFiles.map((file: any) => {
        const originalImg = results.find(img => img.name === file.originalName);
        const originalSize = originalImg?.size || 0;
        
        const scaleFactor = originalSize > 0 ? file.size / originalSize : 1;
        const qualityPercentage = Math.min(Math.round(scaleFactor * 100), 200);
        
        return {
          name: file.originalName,
          originalData: originalImg?.originalData || '',
          finalizedData: `data:image/png;base64,${file.data}`,
          size: file.size,
          originalSize: originalSize,
          compressionRatio: `${Math.round((scaleFactor - 1) * 100)}% larger`,
          qualityPercentage: qualityPercentage
        };
      });

      setUpscaledImages(enhanced);
      toast({
        title: "Enhancement Complete",
        description: "Images have been upscaled and compressed successfully!"
      });
    } catch (error) {
      console.error('Upscale and compress error:', error);
      toast({
        title: "Enhancement Failed",
        description: "Failed to upscale and compress images. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsUpscaling(false);
    }
  };

  const handleRetryIndividual = async (imageIndex: number) => {
    const image = displayImages[imageIndex];
    if (!image.processedData && !image.finalizedData) return;

    // Update retry status
    const updatedImages = [...displayImages];
    updatedImages[imageIndex] = { ...image, retryStatus: 'processing' };
    if (upscaledImages.length > 0) {
      setUpscaledImages(updatedImages);
    } else {
      setProcessedImages(updatedImages);
    }

    try {
      const compositedImageData = image.finalizedData || image.processedData || '';
      
      const { data, error } = await supabase.functions.invoke('retry-single-image-enhancement', {
        body: {
          compositedImageData: compositedImageData.replace(/^data:image\/[a-z]+;base64,/, ''),
          temperature: temperature,
          imageName: image.name
        }
      });

      if (error) throw error;

      if (data.success) {
        // Update image with retry result - handle both enhanced and fallback cases
        updatedImages[imageIndex] = {
          ...image,
          retryStatus: 'completed',
          retryEnhancedData: data.enhancedImageData
        };

        if (data.fallback) {
          toast({
            title: "Enhancement Complete",
            description: `${image.name} - AI enhancement returned to original quality (no changes needed)`
          });
        } else {
          toast({
            title: "Enhancement Complete",
            description: `${image.name} has been enhanced with temperature ${temperature}`
          });
        }
      } else {
        throw new Error(data.error || 'Enhancement failed');
      }
    } catch (error) {
      console.error('Retry enhancement error:', error);
      updatedImages[imageIndex] = { ...image, retryStatus: 'error' };
      
      toast({
        title: "Enhancement Failed",
        description: `Failed to enhance ${image.name}. Please try again.`,
        variant: "destructive"
      });
    }

    // Update state
    if (upscaledImages.length > 0) {
      setUpscaledImages(updatedImages);
    } else {
      setProcessedImages(updatedImages);
    }
  };

  const handleFilenameChange = (index: number, newName: string) => {
    const updatedImages = [...displayImages];
    updatedImages[index] = { ...updatedImages[index], customFilename: newName };
    
    if (upscaledImages.length > 0) {
      setUpscaledImages(updatedImages);
    } else {
      setProcessedImages(updatedImages);
    }
  };

  const getDisplayFilename = (image: ProcessedImage) => {
    return image.customFilename || image.name;
  };

  const getCurrentImageData = (image: ProcessedImage) => {
    return image.retryEnhancedData || image.finalizedData || image.processedData || image.originalData;
  };

  const downloadFile = (dataUrl: string, filename: string) => {
    const link = document.createElement('a');
    link.href = dataUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadAllAsZip = async () => {
    try {
      const zip = new JSZip();
      
      displayImages.forEach((image) => {
        const imageData = getCurrentImageData(image);
        if (imageData) {
          const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
          const filename = getDisplayFilename(image);
          zip.file(filename, base64Data, { base64: true });
        }
      });

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'processed-images.zip';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      toast({
        title: "Download Started",
        description: "Your images are being downloaded as a ZIP file."
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Failed",
        description: "Failed to create ZIP file. Please try downloading images individually.",
        variant: "destructive"
      });
    }
  };

  if (!displayImages || displayImages.length === 0) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="text-center space-y-4">
          <h2 className="text-2xl font-bold">No Images Found</h2>
          <p className="text-muted-foreground">There are no processed images to display.</p>
          <Button onClick={onBack} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Go Back
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-bold">{title}</h2>
          <p className="text-muted-foreground">
            {displayImages.length} image{displayImages.length !== 1 ? 's' : ''} processed
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button onClick={onBack} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
          </Button>
          <Button 
            onClick={() => setIsEditingNames(!isEditingNames)}
            variant="outline"
          >
            <Edit3 className="w-4 h-4 mr-2" />
            {isEditingNames ? 'Done Editing' : 'Edit Names'}
          </Button>
          <Button 
            onClick={handleUpscaleAndCompress} 
            disabled={isUpscaling}
            variant="default"
          >
            <Zap className="w-4 h-4 mr-2" />
            {isUpscaling ? 'Enhancing...' : 'AI Enhance & Upscale'}
          </Button>
          <Button onClick={downloadAllAsZip} variant="default">
            <Download className="w-4 h-4 mr-2" />
            Download All
          </Button>
        </div>
      </div>

      {/* AI Temperature Control */}
      <Card className="p-4">
        <div className="flex items-center gap-4">
          <Label className="text-sm font-medium">AI Enhancement Temperature:</Label>
          <div className="flex-1 max-w-xs">
            <Slider
              value={[temperature]}
              onValueChange={(value) => setTemperature(value[0])}
              min={0.01}
              max={0.99}
              step={0.05}
              className="w-full"
            />
          </div>
          <div className="text-sm text-muted-foreground min-w-[80px]">
            {temperature.toFixed(2)} ({temperature <= 0.3 ? 'Conservative' : temperature <= 0.7 ? 'Balanced' : 'Creative'})
          </div>
        </div>
      </Card>

      <Tabs value={selectedView} onValueChange={(value) => setSelectedView(value as 'grid' | 'comparison')}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="grid">Grid View</TabsTrigger>
          <TabsTrigger value="comparison">Comparison View</TabsTrigger>
        </TabsList>

        <TabsContent value="grid" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayImages.map((image, index) => (
              <Card key={index} className="overflow-hidden">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg flex items-center gap-2">
                    <ImageIcon className="w-5 h-5" />
                    {isEditingNames ? (
                      <Input
                        value={getDisplayFilename(image)}
                        onChange={(e) => handleFilenameChange(index, e.target.value)}
                        className="text-lg font-semibold"
                      />
                    ) : (
                      getDisplayFilename(image)
                    )}
                  </CardTitle>
                  {image.size && (
                    <div className="flex gap-2">
                      <Badge variant="secondary">
                        {formatFileSize(image.size)}
                      </Badge>
                      {image.compressionRatio && (
                        <Badge variant="outline">
                          {image.compressionRatio}
                        </Badge>
                      )}
                    </div>
                  )}
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-background to-muted relative">
                    <img
                      src={getCurrentImageData(image)}
                      alt={image.name}
                      className="w-full h-full object-cover transition-transform hover:scale-105"
                      loading="lazy"
                    />
                    {image.retryStatus === 'processing' && (
                      <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
                        <div className="text-white text-sm">Enhancing...</div>
                      </div>
                    )}
                    {image.retryEnhancedData && (
                      <Badge className="absolute top-2 right-2 bg-green-500">Enhanced</Badge>
                    )}
                  </div>
                  <div className="space-y-2">
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => downloadFile(
                          getCurrentImageData(image) || '',
                          getDisplayFilename(image)
                        )}
                        className="flex-1"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        Download
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedImage(selectedImage === index ? null : index)}
                      >
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                    </div>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => handleRetryIndividual(index)}
                      disabled={image.retryStatus === 'processing'}
                      className="w-full"
                    >
                      <RotateCcw className="w-4 h-4 mr-2" />
                      {image.retryStatus === 'processing' ? 'Enhancing...' : 'Retry Enhancement'}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        <TabsContent value="comparison" className="space-y-4">
          {displayImages.map((image, index) => (
            <Card key={index} className="overflow-hidden">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="w-5 h-5" />
                  {image.name}
                  {image.size && (
                    <Badge variant="secondary" className="ml-auto">
                      {formatFileSize(image.size)}
                    </Badge>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {image.originalData && (
                    <div className="space-y-2">
                      <h4 className="font-medium">Original</h4>
                      <div className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-background to-muted">
                        <img
                          src={image.originalData}
                          alt={`${image.name} - Original`}
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  )}
                  <div className="space-y-2">
                    <h4 className="font-medium">Processed {image.retryEnhancedData ? '(Enhanced)' : ''}</h4>
                    <div className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-background to-muted">
                      <img
                        src={getCurrentImageData(image)}
                        alt={`${image.name} - Processed`}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  </div>
                </div>
                <div className="flex gap-2 mt-4">
                  <Button
                    size="sm"
                    onClick={() => downloadFile(
                      getCurrentImageData(image) || '',
                      getDisplayFilename(image)
                    )}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleRetryIndividual(index)}
                    disabled={image.retryStatus === 'processing'}
                  >
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {image.retryStatus === 'processing' ? 'Enhancing...' : 'Retry Enhancement'}
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      {selectedImage !== null && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={() => setSelectedImage(null)}
        >
          <div className="max-w-4xl max-h-full">
            <img
              src={getCurrentImageData(displayImages[selectedImage])}
              alt={displayImages[selectedImage].name}
              className="max-w-full max-h-full object-contain"
              onClick={(e) => e.stopPropagation()}
            />
          </div>
        </div>
      )}
    </div>
  );
};