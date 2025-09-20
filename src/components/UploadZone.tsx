import { useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import { Upload, Image as ImageIcon, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

interface UploadZoneProps {
  onFilesUploaded: (files: File[]) => void;
}

export const UploadZone = ({ onFilesUploaded }: UploadZoneProps) => {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<string[]>([]);

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const validFiles = acceptedFiles.filter(file => 
      file.type.startsWith('image/') && file.size <= 20 * 1024 * 1024 // 20MB limit
    );
    
    setSelectedFiles(prev => [...prev, ...validFiles].slice(0, 20)); // Max 20 files
    
    // Generate previews
    validFiles.forEach(file => {
      const reader = new FileReader();
      reader.onload = (e) => {
        if (e.target?.result) {
          setPreview(prev => [...prev, e.target!.result as string]);
        }
      };
      reader.readAsDataURL(file);
    });
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: {
      'image/*': ['.png', '.jpg', '.jpeg', '.webp']
    },
    maxFiles: 20,
    maxSize: 20 * 1024 * 1024 // 20MB
  });

  const removeFile = (index: number) => {
    setSelectedFiles(prev => prev.filter((_, i) => i !== index));
    setPreview(prev => prev.filter((_, i) => i !== index));
  };

  const handleProcess = () => {
    if (selectedFiles.length > 0) {
      onFilesUploaded(selectedFiles);
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-8">
      {/* Upload Area */}
      <Card className="shadow-soft border-border/50">
        <CardContent className="p-8">
          <div
            {...getRootProps()}
            className={cn(
              "border-2 border-dashed rounded-lg p-12 text-center cursor-pointer transition-smooth",
              isDragActive 
                ? "border-electric bg-electric/5" 
                : "border-border hover:border-electric/50 hover:bg-electric/5"
            )}
          >
            <input {...getInputProps()} />
            <div className="flex flex-col items-center space-y-4">
              <div className="w-16 h-16 bg-gradient-electric rounded-full flex items-center justify-center">
                <Upload className="w-8 h-8 text-electric-foreground" />
              </div>
              
              {isDragActive ? (
                <p className="text-lg text-foreground font-medium">Drop your photos here!</p>
              ) : (
                <>
                  <h3 className="text-lg font-semibold text-foreground">
                    Drop product photos or click to browse
                  </h3>
                  <p className="text-muted-foreground">
                    Upload up to 20 images • PNG, JPG, WEBP • Max 20MB each
                  </p>
                </>
              )}
              
              <Button variant="outline" size="sm" type="button">
                Choose Files
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* File Preview Grid */}
      {selectedFiles.length > 0 && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="text-lg font-semibold text-foreground">
              Selected Photos ({selectedFiles.length}/20)
            </h3>
            <Button 
              variant="electric" 
              onClick={handleProcess}
              className="px-8"
            >
              Start Processing
              <ImageIcon className="w-4 h-4 ml-2" />
            </Button>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {selectedFiles.map((file, index) => (
              <Card key={index} className="relative group overflow-hidden">
                <CardContent className="p-0">
                  {preview[index] && (
                    <img 
                      src={preview[index]} 
                      alt={file.name}
                      className="w-full h-32 object-cover"
                    />
                  )}
                  
                  <button
                    onClick={() => removeFile(index)}
                    className="absolute top-2 right-2 w-6 h-6 bg-destructive rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-smooth"
                  >
                    <X className="w-4 h-4 text-destructive-foreground" />
                  </button>
                  
                  <div className="p-3">
                    <p className="text-sm font-medium text-foreground truncate">
                      {file.name}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <Badge variant="secondary" className="text-xs">
                        {(file.size / 1024 / 1024).toFixed(1)} MB
                      </Badge>
                      <Badge variant="outline" className="text-xs">
                        {file.type.split('/')[1].toUpperCase()}
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          
          {selectedFiles.length >= 20 && (
            <Card className="border-electric/50 bg-electric/5">
              <CardContent className="p-4">
                <div className="flex items-center space-x-2 text-electric">
                  <AlertCircle className="w-5 h-5" />
                  <p className="text-sm font-medium">
                    Maximum 20 photos reached. Remove some to add more.
                  </p>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};