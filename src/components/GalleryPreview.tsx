import { useState } from "react";
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
  originalData: string; // base64
  processedData: string; // base64
  size: number;
}

interface GalleryPreviewProps {
  processedImages: ProcessedImage[];
  onBack: () => void;
  onRetry: () => void;
}

export const GalleryPreview = ({ processedImages, onBack, onRetry }: GalleryPreviewProps) => {
  const [selectedView, setSelectedView] = useState<'grid' | 'comparison'>('grid');
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaledImages, setUpscaledImages] = useState<ProcessedImage[]>([]);
  const { toast } = useToast();

  // Use upscaled images if available, otherwise use original processed images
  const displayImages = upscaledImages.length > 0 ? upscaledImages : processedImages;

  const handleUpscaleAndCompress = async () => {
    setIsUpscaling(true);
    try {
      // Prepare data for upscaling
      const upscaleData = processedImages.map(img => ({
        name: img.name,
        data: img.processedData,
        size: img.size,
        type: 'image/png'
      }));

      // Call upscale function
      const { data: upscaleResult, error: upscaleError } = await supabase.functions.invoke('upscale-images', {
        body: { files: upscaleData }
      });

      if (upscaleError) throw upscaleError;

      // Then compress the upscaled images
      const { data: compressResult, error: compressError } = await supabase.functions.invoke('compress-images', {
        body: { files: upscaleResult.upscaledFiles }
      });

      if (compressError) throw compressError;

      // Update displayed images with upscaled and compressed versions
      const enhanced = compressResult.compressedFiles.map((file: any) => ({
        name: file.originalName,
        originalData: processedImages.find(img => img.name === file.originalName)?.originalData || '',
        processedData: `data:image/png;base64,${file.data}`,
        size: file.size
      }));

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
        const base64Data = image.processedData.split(',')[1];
        zip.file(`processed_${image.name}`, base64Data, { base64: true });
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
    downloadFile(image.processedData, `processed_${image.name}`);
    toast({
      title: "Download Complete",
      description: `Downloaded ${image.name}`
    });
  };

  const handleRetryProcessing = () => {
    onRetry();
  };

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
              Processing Complete!
            </h2>
            <p className="text-muted-foreground">
              {processedImages.length} photos transformed into studio quality
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
            <h3 className="text-2xl font-bold text-foreground">{processedImages.length}</h3>
            <p className="text-muted-foreground">Photos Processed</p>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Download className="w-6 h-6 text-success" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">
              {(processedImages.reduce((acc, img) => acc + img.size, 0) / 1024 / 1024).toFixed(1)}MB
            </h3>
            <p className="text-muted-foreground">Total Size</p>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-primary/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Zap className="w-6 h-6 text-primary" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">2.3s</h3>
            <p className="text-muted-foreground">Avg. Processing Time</p>
          </CardContent>
        </Card>
      </div>

      {/* View Toggle */}
      <Tabs value={selectedView} onValueChange={(value: any) => setSelectedView(value)}>
        <TabsList className="mb-6">
          <TabsTrigger value="grid">Grid View</TabsTrigger>
          <TabsTrigger value="comparison">Before & After</TabsTrigger>
        </TabsList>

        {/* Grid View */}
        <TabsContent value="grid">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {displayImages.map((image, index) => (
              <Card key={index} className="group shadow-soft hover:shadow-medium transition-smooth">
                <CardContent className="p-0">
                  <div className="relative aspect-square overflow-hidden rounded-t-lg">
                    <img 
                      src={image.processedData}
                      alt={`Processed ${image.name}`}
                      className="w-full h-full object-cover group-hover:scale-105 transition-smooth cursor-pointer"
                      onClick={() => setSelectedImage(index)}
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/50 to-transparent opacity-0 group-hover:opacity-100 transition-smooth" />
                    
                    <Badge className="absolute top-3 left-3 bg-success text-success-foreground">
                      Studio Quality
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
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={handleRetryProcessing}
                        title="Retry entire processing workflow"
                      >
                        <RotateCcw className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>

        {/* Comparison View */}
        <TabsContent value="comparison">
          <div className="space-y-8">
            {displayImages.map((image, index) => (
              <Card key={index} className="shadow-soft">
                <CardHeader>
                  <CardTitle className="flex items-center justify-between">
                    <span>Photo {index + 1}: {image.name}</span>
                    <div className="flex items-center space-x-2">
                      <Button 
                        size="sm" 
                        variant="electric"
                        onClick={() => handleDownloadSingle(index)}
                      >
                        <Download className="w-4 h-4 mr-1" />
                        Download
                      </Button>
                      <Button 
                        size="sm" 
                        variant="outline"
                        onClick={handleRetryProcessing}
                        title="Retry entire processing workflow"
                      >
                        <RotateCcw className="w-4 h-4 mr-1" />
                        Retry
                      </Button>
                    </div>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <h4 className="font-medium text-muted-foreground">Original</h4>
                      <div className="aspect-square rounded-lg overflow-hidden border border-border">
                        <img 
                          src={image.originalData}
                          alt="Original"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium text-success">Studio Enhanced</h4>
                      <div className="aspect-square rounded-lg overflow-hidden border border-success/50">
                        <img 
                          src={image.processedData}
                          alt="Processed"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
};