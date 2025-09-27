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
  originalData: string; // base64
  processedData: string; // base64
  size: number;
}

interface GalleryPreviewProps {
  processedImages: ProcessedImage[];
  jobId?: string;
  onBack: () => void;
  onRetry: () => void;
}

export const GalleryPreview = ({ processedImages, jobId, onBack, onRetry }: GalleryPreviewProps) => {
  const [selectedView, setSelectedView] = useState<'grid' | 'comparison'>('grid');
  const [selectedImage, setSelectedImage] = useState<number | null>(null);
  const [isUpscaling, setIsUpscaling] = useState(false);
  const [upscaledImages, setUpscaledImages] = useState<ProcessedImage[]>([]);
  const [jobStatus, setJobStatus] = useState<string>('pending');
  const [jobResults, setJobResults] = useState<ProcessedImage[]>([]);
  const [isMonitoringJob, setIsMonitoringJob] = useState(false);
  const { toast } = useToast();

  // Monitor job progress with real-time updates
  React.useEffect(() => {
    if (!jobId || processedImages.length > 0) return;

    setIsMonitoringJob(true);
    console.log('Starting real-time monitoring for job:', jobId);

    const channel = supabase
      .channel('job-monitoring')
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'processing_jobs',
          filter: `id=eq.${jobId}`
        },
        (payload) => {
          console.log('Job update received:', payload);
          const updatedJob = payload.new as any;
          
          setJobStatus(updatedJob.status);
          
          if (updatedJob.status === 'completed' && updatedJob.results) {
            const results = Array.isArray(updatedJob.results) ? updatedJob.results.map((result: any) => ({
              name: result.name,
              originalData: '', 
              processedData: result.finalizedData,
              size: result.finalizedData.length * 0.75
            })) : [];
            
            setJobResults(results);
            setIsMonitoringJob(false);
            
            toast({
              title: "Processing Complete!",
              description: `Successfully processed ${results.length} images`
            });
          } else if (updatedJob.status === 'failed') {
            setIsMonitoringJob(false);
            toast({
              title: "Processing Failed", 
              description: "There was an error processing your images. Please try again.",
              variant: "destructive"
            });
          }
        }
      )
      .subscribe();

    // Check current job status
    const checkJobStatus = async () => {
      const { data: job, error } = await supabase
        .from('processing_jobs')
        .select('*')
        .eq('id', jobId)
        .single();

      if (job && job.status) {
        setJobStatus(job.status);
        
        if (job.status === 'completed' && (job as any).results) {
          const results = Array.isArray((job as any).results) ? (job as any).results.map((result: any) => ({
            name: result.name,
            originalData: '',
            processedData: result.finalizedData,
            size: result.finalizedData.length * 0.75
          })) : [];
          
          setJobResults(results);
          setIsMonitoringJob(false);
        } else if (job.status === 'failed') {
          setIsMonitoringJob(false);
        }
      }
    };

    checkJobStatus();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [jobId, processedImages.length]);

  // Use job results if available, otherwise use provided processed images or upscaled images
  const displayImages = jobResults.length > 0 ? jobResults : 
                      upscaledImages.length > 0 ? upscaledImages : 
                      processedImages;

  const handleUpscaleAndCompress = async () => {
    setIsUpscaling(true);
    try {
      // Prepare data for upscaling
      const upscaleData = processedImages.map(img => ({
        name: img.name,
        data: img.processedData.replace(/^data:image\/[a-z]+;base64,/, ''), // Remove data URL prefix
        size: img.size,
        type: 'image/png'
      }));

      // Process images in batches of 2 to avoid CPU timeouts
      const BATCH_SIZE = 2;
      const allUpscaledFiles: any[] = [];
      
      // Upscale in batches
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

      // Compress the upscaled images in batches
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

      // Update displayed images with upscaled and compressed versions
      const enhanced = allCompressedFiles.map((file: any) => ({
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
      {/* Processing Status */}
      {isMonitoringJob && (
        <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
          <div className="flex items-center space-x-3">
            <div className="animate-spin rounded-full h-4 w-4 border-2 border-primary border-t-transparent"></div>
            <div>
              <h3 className="font-medium text-foreground">Processing in Progress</h3>
              <p className="text-sm text-muted-foreground">
                Status: {jobStatus} • Your images are being processed by our AI pipeline
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-4">
          <Button variant="ghost" onClick={onBack}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Upload
          </Button>
          <div>
            <h2 className="text-3xl font-bold text-foreground">
              {displayImages.length > 0 ? 'Processing Complete!' : 'Processing Your Images...'}
            </h2>
            <p className="text-muted-foreground">
              {displayImages.length > 0 
                ? `${displayImages.length} photos transformed into studio quality`
                : 'Please wait while we process your images...'
              }
            </p>
          </div>
        </div>
        
        {displayImages.length > 0 && (
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
        )}
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