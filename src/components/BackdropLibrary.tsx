import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/use-toast";
import { Trash2, ImageIcon, Download } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface Backdrop {
  id: string;
  name: string;
  storage_path: string;
  file_size: number;
  dimensions: { width: number; height: number };
  created_at: string;
  cloudinary_public_id?: string;
}

interface BackdropLibraryProps {
  refreshTrigger?: number;
  allowDelete?: boolean;
  onSelect?: (backdrop: Backdrop, imageUrl: string) => void;
  selectionMode?: boolean;
}

export const BackdropLibrary = ({ 
  refreshTrigger, 
  allowDelete = false, 
  onSelect,
  selectionMode = false 
}: BackdropLibraryProps) => {
  const [backdrops, setBackdrops] = useState<Backdrop[]>([]);
  const [loading, setLoading] = useState(true);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const { toast } = useToast();

  const fetchBackdrops = async () => {
    try {
      const { data, error } = await supabase
        .from('backdrop_library')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Transform the data to ensure proper typing for dimensions
      const transformedBackdrops = (data || []).map(backdrop => ({
        ...backdrop,
        dimensions: backdrop.dimensions as { width: number; height: number }
      }));
      
      setBackdrops(transformedBackdrops);
      
      // Fetch image URLs for all backdrops
      const urls: Record<string, string> = {};
      for (const backdrop of data || []) {
        const { data: urlData } = await supabase.storage
          .from('user-backdrops')
          .createSignedUrl(backdrop.storage_path, 3600); // 1 hour expiry
        
        if (urlData?.signedUrl) {
          urls[backdrop.id] = urlData.signedUrl;
        }
      }
      setImageUrls(urls);
    } catch (error: any) {
      console.error('Error fetching backdrops:', error);
      toast({
        title: "Error",
        description: "Failed to load backdrop library.",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (backdrop: Backdrop) => {
    try {
      // Delete from storage
      const { error: storageError } = await supabase.storage
        .from('user-backdrops')
        .remove([backdrop.storage_path]);

      if (storageError) throw storageError;

      // Delete from database
      const { error: dbError } = await supabase
        .from('backdrop_library')
        .delete()
        .eq('id', backdrop.id);

      if (dbError) throw dbError;

      toast({
        title: "Backdrop Deleted",
        description: `"${backdrop.name}" has been removed from your library.`
      });

      fetchBackdrops(); // Refresh the list
    } catch (error: any) {
      console.error('Error deleting backdrop:', error);
      toast({
        title: "Delete Failed",
        description: error.message || "Failed to delete backdrop. Please try again.",
        variant: "destructive"
      });
    }
  };

  const handleSelect = (backdrop: Backdrop) => {
    if (onSelect && imageUrls[backdrop.id]) {
      onSelect(backdrop, imageUrls[backdrop.id]);
    }
  };

  useEffect(() => {
    fetchBackdrops();
  }, [refreshTrigger]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="animate-pulse">
            <CardContent className="p-4">
              <div className="aspect-video bg-muted rounded-lg mb-3"></div>
              <div className="h-4 bg-muted rounded mb-2"></div>
              <div className="h-3 bg-muted rounded w-2/3"></div>
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (backdrops.length === 0) {
    return (
      <Card>
        <CardContent className="p-8 text-center">
          <ImageIcon className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium mb-2">No backdrops yet</h3>
          <p className="text-muted-foreground">
            Upload your first backdrop to get started building your library.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {backdrops.map((backdrop) => (
        <Card 
          key={backdrop.id} 
          className={`overflow-hidden transition-all ${
            selectionMode 
              ? "cursor-pointer hover:ring-2 hover:ring-primary" 
              : ""
          }`}
          onClick={selectionMode ? () => handleSelect(backdrop) : undefined}
        >
          <CardContent className="p-0">
            <div className="aspect-video relative overflow-hidden bg-muted">
              {imageUrls[backdrop.id] ? (
                <img
                  src={imageUrls[backdrop.id]}
                  alt={backdrop.name}
                  className="w-full h-full object-cover"
                  loading="lazy"
                />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <ImageIcon className="h-8 w-8 text-muted-foreground" />
                </div>
              )}
            </div>
            
            <div className="p-4">
              <h3 className="font-medium truncate mb-2">{backdrop.name}</h3>
              
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-3">
                <span>
                  {backdrop.dimensions.width} × {backdrop.dimensions.height}
                </span>
                <Badge variant="secondary" className="text-xs">
                  {(backdrop.file_size / (1024 * 1024)).toFixed(1)} MB
                </Badge>
              </div>

              {allowDelete && !selectionMode && (
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      if (imageUrls[backdrop.id]) {
                        const link = document.createElement('a');
                        link.href = imageUrls[backdrop.id];
                        link.download = `${backdrop.name}.jpg`;
                        link.click();
                      }
                    }}
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                  
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete Backdrop</AlertDialogTitle>
                        <AlertDialogDescription>
                          Are you sure you want to delete "{backdrop.name}"? This action cannot be undone.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          onClick={() => handleDelete(backdrop)}
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              )}

              {selectionMode && (
                <Button 
                  className="w-full mt-2" 
                  size="sm"
                  onClick={() => handleSelect(backdrop)}
                >
                  Select This Backdrop
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
};