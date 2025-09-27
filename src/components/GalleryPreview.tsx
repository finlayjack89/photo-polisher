import React, { useState } from "react";
import { Download, RotateCcw, Zap, Image as ImageIcon, ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const { toast } = useToast();

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Use results from V5 architecture or upscaled images
  const displayImages = upscaledImages.length > 0 ? upscaledImages : results;

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
        const imageData = image.finalizedData || image.processedData;
        if (imageData) {
          const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
          zip.file(`${image.name}`, base64Data, { base64: true });
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
        <div className="flex gap-2">
          <Button onClick={onBack} variant="outline">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back
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
                    {image.name}
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
                  <div className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-background to-muted">
                    <img
                      src={image.finalizedData || image.processedData || image.originalData}
                      alt={image.name}
                      className="w-full h-full object-cover transition-transform hover:scale-105"
                      loading="lazy"
                    />
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => downloadFile(
                        image.finalizedData || image.processedData || image.originalData || '',
                        image.name
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
                    <h4 className="font-medium">Processed</h4>
                    <div className="aspect-square rounded-lg overflow-hidden bg-gradient-to-br from-background to-muted">
                      <img
                        src={image.finalizedData || image.processedData || image.originalData}
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
                      image.finalizedData || image.processedData || image.originalData || '',
                      image.name
                    )}
                  >
                    <Download className="w-4 h-4 mr-2" />
                    Download
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
              src={displayImages[selectedImage].finalizedData || displayImages[selectedImage].processedData || displayImages[selectedImage].originalData}
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