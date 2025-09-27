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

  const handleDownloadAll = async () => {
    try {
      const zip = new JSZip();
      
      displayImages.forEach((image, index) => {
        const imageData = image.finalizedData || image.processedData || '';
        const base64Data = imageData.split(',')[1];
        if (base64Data) {
          zip.file(`processed_${image.name}`, base64Data, { base64: true });
        }
      });

      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const url = URL.createObjectURL(zipBlob);
      downloadFile(url, 'processed_images.zip');
      URL.revokeObjectURL(url);
      
      toast({
        title: "Download Complete",
        description: `Downloaded ${displayImages.length} images as ZIP file.`
      });
    } catch (error) {
      console.error('Download error:', error);
      toast({
        title: "Download Failed",
        description: "Failed to create ZIP file. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleDownloadSingle = (index: number) => {
    const image = displayImages[index];
    const imageData = image.finalizedData || image.processedData || '';
    if (imageData) {
      downloadFile(imageData, `processed_${image.name}`);
      toast({
        title: "Download Complete",
        description: `Downloaded ${image.name}`
      });
    }
  };

  if (displayImages.length === 0) {
    return (
      <div className="max-w-6xl mx-auto space-y-8">
        <div className="text-center py-12">
          <h3 className="text-lg font-medium text-foreground mb-2">No images to display</h3>
          <p className="text-muted-foreground mb-4">
            Process some images to see results here.
          </p>
          <Button onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Upload
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Upload
          </Button>
          <div>
            <h2 className="text-3xl font-bold text-foreground">
              {title}
            </h2>
            <p className="text-muted-foreground">
              {displayImages.length} photos transformed with V5 architecture
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <Button 
            variant="outline" 
            onClick={handleUpscaleAndCompress}
            disabled={isUpscaling}
          >
            <Zap className="w-4 h-4 mr-2" />
            {isUpscaling ? 'Processing...' : 'Upscale & Compress'}
          </Button>
          <Button variant="electric" onClick={handleDownloadAll}>
            <Download className="w-4 h-4 mr-2" />
            Download All (ZIP)
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card className="shadow-soft">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-gradient-electric rounded-full flex items-center justify-center mx-auto mb-3">
              <ImageIcon className="w-6 h-6 text-electric-foreground" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">{displayImages.length}</h3>
            <p className="text-muted-foreground">Photos Processed</p>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Download className="w-6 h-6 text-success" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">
              {(displayImages.reduce((acc, img) => acc + (img.size || 0), 0) / 1024 / 1024).toFixed(1)}MB
            </h3>
            <p className="text-muted-foreground">Total Size</p>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">2.5s</h3>
            <p className="text-muted-foreground">V5 Processing Time</p>
          </CardContent>
        </Card>
      </div>

      {/* Grid View */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {displayImages.map((image, index) => {
          const imageData = image.finalizedData || image.processedData || '';
          return (
            <Card key={index} className="group shadow-soft hover:shadow-medium transition-smooth">
              <CardContent className="p-0">
                <div className="relative aspect-square overflow-hidden rounded-t-lg">
                  <img 
                    src={imageData}
                    alt={`Processed ${image.name}`}
                    className="w-full h-full object-cover group-hover:scale-105 transition-smooth cursor-pointer"
                    onClick={() => setSelectedImage(index)}
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-smooth" />
                  
                  <Badge className="absolute top-3 left-3 bg-success text-success-foreground">
                    V5 Quality
                  </Badge>
                  
                  <div className="absolute bottom-3 right-3 opacity-0 group-hover:opacity-100 transition-smooth">
                    <Button size="sm" variant="glass" onClick={() => setSelectedImage(index)}>
                      <ExternalLink className="w-4 h-4" />
                    </Button>
                  </div>
                </div>
                
                <div className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h4 className="font-medium text-foreground truncate">
                      {image.name}
                    </h4>
                    <Badge variant="outline" className="text-xs">
                      PNG
                    </Badge>
                  </div>
                  
                  {/* Size and Quality Info */}
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between items-center">
                      <span className="text-muted-foreground">Size:</span>
                      <span className="font-medium">{formatFileSize(image.size || 0)}</span>
                    </div>
                    
                    {image.originalSize && image.originalSize !== image.size && (
                      <>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Original:</span>
                          <span className="text-muted-foreground">{formatFileSize(image.originalSize)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                          <span className="text-muted-foreground">Change:</span>
                          <Badge variant="secondary" className="text-xs">
                            {image.compressionRatio}
                          </Badge>
                        </div>
                        {image.qualityPercentage && (
                          <div className="flex justify-between items-center">
                            <span className="text-muted-foreground">Quality:</span>
                            <Badge variant={image.qualityPercentage >= 90 ? "default" : "secondary"} className="text-xs">
                              {image.qualityPercentage}%
                            </Badge>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                  
                  <div className="flex items-center space-x-2">
                    <Button 
                      size="sm" 
                      variant="electric"
                      onClick={() => handleDownloadSingle(index)}
                      className="flex-1"
                    >
                      <Download className="w-4 h-4 mr-1" />
                      Download
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Full Screen Modal */}
      {selectedImage !== null && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4">
          <div className="relative max-w-4xl max-h-full">
            <Button 
              variant="ghost" 
              size="sm"
              className="absolute -top-12 right-0 text-white hover:text-gray-300"
              onClick={() => setSelectedImage(null)}
            >
              Close ✕
            </Button>
            <img 
              src={displayImages[selectedImage].finalizedData || displayImages[selectedImage].processedData || ''}
              alt={`Full size ${displayImages[selectedImage].name}`}
              className="max-w-full max-h-full object-contain rounded-lg"
            />
          </div>
        </div>
      )}
    </div>
  );
};