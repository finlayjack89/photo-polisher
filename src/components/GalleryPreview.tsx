import { useState } from "react";
import { Download, RotateCcw, Zap, Image as ImageIcon, ArrowLeft, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";

interface GalleryPreviewProps {
  files: File[];
  onBack: () => void;
}

export const GalleryPreview = ({ files, onBack }: GalleryPreviewProps) => {
  const [selectedView, setSelectedView] = useState<'grid' | 'comparison'>('grid');
  const [selectedImage, setSelectedImage] = useState<number | null>(null);

  // Mock processed versions for demo
  const processedImages = files.map((file, index) => ({
    original: URL.createObjectURL(file),
    processed: URL.createObjectURL(file), // In real app, this would be the processed version
    name: file.name,
    size: file.size,
    status: 'completed' as const
  }));

  const handleDownloadAll = () => {
    // Mock download functionality
    console.log('Downloading all processed images...');
  };

  const handleDownloadSingle = (index: number) => {
    console.log(`Downloading image ${index + 1}...`);
  };

  const handleRetry = (index: number) => {
    console.log(`Retrying processing for image ${index + 1}...`);
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
              {files.length} photos transformed into studio quality
            </p>
          </div>
        </div>
        
        <div className="flex items-center space-x-4">
          <Button variant="outline">
            <Zap className="w-4 h-4 mr-2" />
            Upscale & Compress
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
            <h3 className="text-2xl font-bold text-foreground">{files.length}</h3>
            <p className="text-muted-foreground">Photos Processed</p>
          </CardContent>
        </Card>
        
        <Card className="shadow-soft">
          <CardContent className="p-6 text-center">
            <div className="w-12 h-12 bg-success/20 rounded-full flex items-center justify-center mx-auto mb-3">
              <Download className="w-6 h-6 text-success" />
            </div>
            <h3 className="text-2xl font-bold text-foreground">
              {(files.reduce((acc, file) => acc + file.size, 0) / 1024 / 1024).toFixed(1)}MB
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
            {processedImages.map((image, index) => (
              <Card key={index} className="group shadow-soft hover:shadow-medium transition-smooth">
                <CardContent className="p-0">
                  <div className="relative aspect-square overflow-hidden rounded-t-lg">
                    <img 
                      src={image.processed}
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
                        onClick={() => handleRetry(index)}
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
            {processedImages.map((image, index) => (
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
                        onClick={() => handleRetry(index)}
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
                          src={image.original}
                          alt="Original"
                          className="w-full h-full object-cover"
                        />
                      </div>
                    </div>
                    
                    <div className="space-y-2">
                      <h4 className="font-medium text-success">Studio Enhanced</h4>
                      <div className="aspect-square rounded-lg overflow-hidden border border-success/50">
                        <img 
                          src={image.processed}
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