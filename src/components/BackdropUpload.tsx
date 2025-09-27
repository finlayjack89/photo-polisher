import { useState } from "react";
import { useDropzone } from "react-dropzone";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { useToast } from "@/components/ui/use-toast";
import { Upload, X, Check } from "lucide-react";

interface BackdropUploadProps {
  onUploadComplete: () => void;
}

export const BackdropUpload = ({ onUploadComplete }: BackdropUploadProps) => {
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [backdropName, setBackdropName] = useState("");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const { toast } = useToast();

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    accept: {
      'image/*': ['.jpeg', '.jpg', '.png', '.webp']
    },
    maxFiles: 1,
    maxSize: 50 * 1024 * 1024, // 50MB
    onDrop: (acceptedFiles) => {
      if (acceptedFiles.length > 0) {
        const file = acceptedFiles[0];
        setSelectedFile(file);
        setBackdropName(file.name.replace(/\.[^/.]+$/, ""));
      }
    }
  });

  const getImageDimensions = (file: File): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.width, height: img.height });
      };
      img.src = URL.createObjectURL(file);
    });
  };

  const handleUpload = async () => {
    if (!selectedFile || !backdropName.trim()) {
      toast({
        title: "Missing Information",
        description: "Please select a file and provide a name for the backdrop.",
        variant: "destructive"
      });
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        throw new Error("You must be logged in to upload backdrops");
      }

      // Get image dimensions
      const dimensions = await getImageDimensions(selectedFile);
      
      // Create file path with user ID folder
      const fileExt = selectedFile.name.split('.').pop();
      const fileName = `${Date.now()}-${backdropName.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      // Upload to Supabase Storage
      setUploadProgress(25);
      const { error: uploadError } = await supabase.storage
        .from('user-backdrops')
        .upload(filePath, selectedFile);

      if (uploadError) throw uploadError;

      setUploadProgress(75);

      // Save backdrop metadata to database
      const { error: dbError } = await supabase
        .from('backdrop_library')
        .insert({
          user_id: user.id,
          name: backdropName.trim(),
          storage_path: filePath,
          file_size: selectedFile.size,
          dimensions: dimensions
        });

      if (dbError) throw dbError;

      setUploadProgress(100);

      toast({
        title: "Backdrop Uploaded",
        description: `"${backdropName}" has been added to your library.`
      });

      // Reset form
      setSelectedFile(null);
      setBackdropName("");
      onUploadComplete();

    } catch (error: any) {
      console.error('Upload error:', error);
      toast({
        title: "Upload Failed",
        description: error.message || "Failed to upload backdrop. Please try again.",
        variant: "destructive"
      });
    } finally {
      setUploading(false);
      setUploadProgress(0);
    }
  };

  const clearSelection = () => {
    setSelectedFile(null);
    setBackdropName("");
  };

  return (
    <div className="space-y-6">
      {!selectedFile ? (
        <Card>
          <CardContent className="pt-6">
            <div
              {...getRootProps()}
              className={`border-2 border-dashed rounded-lg p-8 text-center transition-colors cursor-pointer ${
                isDragActive 
                  ? "border-primary bg-primary/5" 
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
            >
              <input {...getInputProps()} />
              <Upload className="mx-auto h-12 w-12 text-muted-foreground mb-4" />
              <p className="text-lg font-medium mb-2">
                {isDragActive ? "Drop the backdrop here" : "Upload a backdrop image"}
              </p>
              <p className="text-muted-foreground">
                Drag & drop an image file or click to browse
              </p>
              <p className="text-sm text-muted-foreground mt-2">
                Supports JPG, PNG, WebP • Max 50MB
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-6">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-3">
                  <Check className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium">{selectedFile.name}</p>
                    <p className="text-sm text-muted-foreground">
                      {(selectedFile.size / (1024 * 1024)).toFixed(2)} MB
                    </p>
                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={clearSelection}>
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="backdrop-name">Backdrop Name</Label>
                <Input
                  id="backdrop-name"
                  value={backdropName}
                  onChange={(e) => setBackdropName(e.target.value)}
                  placeholder="Enter a name for this backdrop"
                  disabled={uploading}
                />
              </div>

              {uploading && (
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span>Uploading...</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <Progress value={uploadProgress} />
                </div>
              )}

              <Button 
                onClick={handleUpload} 
                disabled={uploading || !backdropName.trim()}
                className="w-full"
              >
                {uploading ? "Uploading..." : "Upload Backdrop"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};