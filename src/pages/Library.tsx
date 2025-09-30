import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Download, Trash2, Edit, FolderOpen, Image as ImageIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';

interface BatchImage {
  id: string;
  name: string;
  image_type: 'transparent' | 'ai_enhanced' | 'final';
  storage_path: string;
  file_size: number;
  dimensions: { width: number; height: number };
  sort_order: number;
  created_at: string;
}

interface ProjectBatch {
  id: string;
  name: string;
  thumbnail_url: string | null;
  created_at: string;
  images: BatchImage[];
}

const Library = () => {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const [batches, setBatches] = useState<ProjectBatch[]>([]);
  const [selectedBatch, setSelectedBatch] = useState<ProjectBatch | null>(null);
  const [loading, setLoading] = useState(true);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (user) {
      fetchBatches();
    }
  }, [user]);

  const fetchBatches = async () => {
    if (!user) return;

    try {
      setLoading(true);
      
      // Fetch batches with their images
      const { data: batchesData, error: batchesError } = await supabase
        .from('project_batches')
        .select(`
          id,
          name,
          thumbnail_url,
          created_at,
          batch_images (
            id,
            name,
            image_type,
            storage_path,
            file_size,
            dimensions,
            sort_order,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (batchesError) throw batchesError;

      const formattedBatches = (batchesData || []).map(batch => ({
        ...batch,
        images: (batch.batch_images || []).sort((a, b) => a.sort_order - b.sort_order)
      }));

      setBatches(formattedBatches);

      // Generate signed URLs for all images
      const urls: Record<string, string> = {};
      for (const batch of formattedBatches) {
        for (const image of batch.images) {
          const { data: urlData } = await supabase.storage
            .from('project-images')
            .createSignedUrl(image.storage_path, 3600);
          
          if (urlData?.signedUrl) {
            urls[image.id] = urlData.signedUrl;
          }
        }
        
        // Get thumbnail URL
        if (batch.thumbnail_url) {
          const { data: thumbData } = await supabase.storage
            .from('project-images')
            .createSignedUrl(batch.thumbnail_url, 3600);
          
          if (thumbData?.signedUrl) {
            urls[`thumb_${batch.id}`] = thumbData.signedUrl;
          }
        }
      }
      
      setImageUrls(urls);
    } catch (error) {
      console.error('Error fetching batches:', error);
      toast({
        title: 'Error',
        description: 'Failed to load library. Please try again.',
        variant: 'destructive'
      });
    } finally {
      setLoading(false);
    }
  };

  const deleteBatch = async (batchId: string) => {
    try {
      const { error } = await supabase
        .from('project_batches')
        .delete()
        .eq('id', batchId);

      if (error) throw error;

      toast({
        title: 'Success',
        description: 'Batch deleted successfully'
      });

      fetchBatches();
      setSelectedBatch(null);
    } catch (error) {
      console.error('Error deleting batch:', error);
      toast({
        title: 'Error',
        description: 'Failed to delete batch',
        variant: 'destructive'
      });
    }
  };

  const downloadImage = async (image: BatchImage) => {
    const url = imageUrls[image.id];
    if (!url) return;

    try {
      const response = await fetch(url);
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = downloadUrl;
      link.download = image.name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(downloadUrl);
    } catch (error) {
      console.error('Error downloading image:', error);
      toast({
        title: 'Error',
        description: 'Failed to download image',
        variant: 'destructive'
      });
    }
  };

  const reEditTransparentImages = async (batchId: string) => {
    // TODO: Navigate to editing workflow with transparent images
    toast({
      title: 'Coming Soon',
      description: 'Re-editing feature will be available soon'
    });
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>Sign in Required</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">Please sign in to view your library.</p>
            <Button onClick={() => navigate('/auth')}>Sign In</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (selectedBatch) {
    const transparentImages = selectedBatch.images.filter(img => img.image_type === 'transparent');
    const aiEnhancedImages = selectedBatch.images.filter(img => img.image_type === 'ai_enhanced');
    const finalImages = selectedBatch.images.filter(img => img.image_type === 'final');

    return (
      <div className="min-h-screen bg-background">
        <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
          <div className="container mx-auto px-6 py-4">
            <Button variant="ghost" onClick={() => setSelectedBatch(null)}>
              <ArrowLeft className="w-4 h-4 mr-2" />
              Back to Library
            </Button>
          </div>
        </header>

        <main className="container mx-auto px-6 py-8">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-3xl font-bold mb-2">{selectedBatch.name}</h1>
              <p className="text-muted-foreground">
                Created {new Date(selectedBatch.created_at).toLocaleDateString()}
              </p>
            </div>
            <Button
              variant="destructive"
              onClick={() => deleteBatch(selectedBatch.id)}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Batch
            </Button>
          </div>

          <Tabs defaultValue="all" className="w-full">
            <TabsList>
              <TabsTrigger value="all">All ({selectedBatch.images.length})</TabsTrigger>
              <TabsTrigger value="transparent">Transparent ({transparentImages.length})</TabsTrigger>
              <TabsTrigger value="ai">AI Enhanced ({aiEnhancedImages.length})</TabsTrigger>
              <TabsTrigger value="final">Final ({finalImages.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="all" className="mt-6">
              <ImageGrid 
                images={selectedBatch.images} 
                imageUrls={imageUrls}
                onDownload={downloadImage}
              />
            </TabsContent>

            <TabsContent value="transparent" className="mt-6">
              <div className="mb-4">
                <Button
                  onClick={() => reEditTransparentImages(selectedBatch.id)}
                  disabled={transparentImages.length === 0}
                >
                  <Edit className="w-4 h-4 mr-2" />
                  Re-edit These Images
                </Button>
              </div>
              <ImageGrid 
                images={transparentImages} 
                imageUrls={imageUrls}
                onDownload={downloadImage}
              />
            </TabsContent>

            <TabsContent value="ai" className="mt-6">
              <ImageGrid 
                images={aiEnhancedImages} 
                imageUrls={imageUrls}
                onDownload={downloadImage}
              />
            </TabsContent>

            <TabsContent value="final" className="mt-6">
              <ImageGrid 
                images={finalImages} 
                imageUrls={imageUrls}
                onDownload={downloadImage}
              />
            </TabsContent>
          </Tabs>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4">
          <Button variant="ghost" onClick={() => navigate('/')}>
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to Home
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-6 py-8">
        <div className="mb-8">
          <h1 className="text-4xl font-bold mb-2">Your Library</h1>
          <p className="text-muted-foreground">Browse and manage your edited image batches</p>
        </div>

        {loading ? (
          <div className="text-center py-12">
            <p className="text-muted-foreground">Loading your library...</p>
          </div>
        ) : batches.length === 0 ? (
          <Card className="max-w-md mx-auto">
            <CardContent className="pt-6 text-center">
              <FolderOpen className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
              <h3 className="text-xl font-semibold mb-2">No Batches Yet</h3>
              <p className="text-muted-foreground mb-4">
                Start by editing some images to build your library
              </p>
              <Button onClick={() => navigate('/')}>
                Get Started
              </Button>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {batches.map(batch => (
              <Card
                key={batch.id}
                className="cursor-pointer hover:border-electric transition-colors"
                onClick={() => setSelectedBatch(batch)}
              >
                <CardHeader>
                  <div className="aspect-video bg-muted rounded-md mb-3 overflow-hidden">
                    {batch.thumbnail_url && imageUrls[`thumb_${batch.id}`] ? (
                      <img
                        src={imageUrls[`thumb_${batch.id}`]}
                        alt={batch.name}
                        className="w-full h-full object-contain"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <ImageIcon className="w-12 h-12 text-muted-foreground" />
                      </div>
                    )}
                  </div>
                  <CardTitle className="text-lg">{batch.name}</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex items-center justify-between text-sm text-muted-foreground">
                    <span>{batch.images.length} images</span>
                    <span>{new Date(batch.created_at).toLocaleDateString()}</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </main>
    </div>
  );
};

interface ImageGridProps {
  images: BatchImage[];
  imageUrls: Record<string, string>;
  onDownload: (image: BatchImage) => void;
}

const ImageGrid: React.FC<ImageGridProps> = ({ images, imageUrls, onDownload }) => {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'transparent': return 'bg-blue-500/10 text-blue-500';
      case 'ai_enhanced': return 'bg-purple-500/10 text-purple-500';
      case 'final': return 'bg-green-500/10 text-green-500';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  if (images.length === 0) {
    return (
      <div className="text-center py-12">
        <ImageIcon className="w-16 h-16 mx-auto mb-4 text-muted-foreground" />
        <p className="text-muted-foreground">No images in this category</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
      {images.map(image => (
        <Card key={image.id}>
          <CardContent className="pt-6">
            <div className="aspect-square bg-muted rounded-md mb-3 overflow-hidden">
              {imageUrls[image.id] ? (
                <img
                  src={imageUrls[image.id]}
                  alt={image.name}
                  className="w-full h-full object-contain"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="w-12 h-12 text-muted-foreground" />
                </div>
              )}
            </div>
            
            <div className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-medium text-sm truncate flex-1">{image.name}</h4>
                <Badge variant="secondary" className={getTypeColor(image.image_type)}>
                  {image.image_type.replace('_', ' ')}
                </Badge>
              </div>
              
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  {image.dimensions.width}×{image.dimensions.height}
                </span>
                <span>{formatFileSize(image.file_size)}</span>
              </div>
              
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => onDownload(image)}
              >
                <Download className="w-3 h-3 mr-2" />
                Download
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};

export default Library;
