import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, Zap, ArrowRight } from "lucide-react";

interface ImageCompressionStepProps {
  files: File[];
  compressionAnalysis: {
    totalSize: number;
    largeFiles: number;
    needsResize?: boolean;
    maxDimension?: number;
  };
  onCompress: () => void;
  onSkip: () => void;
  isProcessing: boolean;
}

export const ImageCompressionStep: React.FC<ImageCompressionStepProps> = ({
  files,
  compressionAnalysis,
  onCompress,
  onSkip,
  isProcessing
}) => {
  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="container mx-auto px-4 py-8">
      <div className="max-w-4xl mx-auto">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold mb-2">Images Already Optimized</h1>
          <p className="text-muted-foreground">
            Your images have been automatically processed to 2048px max and under 5MB during upload
          </p>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center mb-4">
              <Zap className="h-12 w-12 text-green-500" />
            </div>
            <CardTitle className="text-xl">
              Images Ready for Processing
            </CardTitle>
          </CardHeader>
          
          <CardContent className="space-y-6">
            <div className="bg-muted/50 rounded-lg p-4 space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total Images:</span>
                <Badge variant="secondary">{files.length}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Total Size:</span>
                <Badge variant={compressionAnalysis.totalSize > 200 * 1024 * 1024 ? "destructive" : "secondary"}>
                  {formatFileSize(compressionAnalysis.totalSize)}
                </Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Optimized Images (&lt;5MB):</span>
                <Badge variant="secondary">{files.length}</Badge>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm font-medium">Max Dimensions:</span>
                <Badge variant="outline">2048px × 2048px</Badge>
              </div>
            </div>

            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Zap className="h-5 w-5 text-green-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-green-900 dark:text-green-100 mb-1">
                    ✓ Images Pre-Optimized
                  </h4>
                  <p className="text-sm text-green-700 dark:text-green-200">
                    All images have been automatically resized to 2048px maximum dimensions and compressed to under 5MB using smart quality optimization during upload.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button 
                onClick={onSkip} 
                className="flex-1"
                disabled={isProcessing}
              >
                <ArrowRight className="h-4 w-4 mr-2" />
                Continue to Background Removal
              </Button>
            </div>

            {/* Download Original Images Button */}
            <div className="text-center">
              <Button 
                variant="ghost" 
                size="sm"
                onClick={() => {
                  files.forEach((file) => {
                    const url = URL.createObjectURL(file);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = file.name;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                    URL.revokeObjectURL(url);
                  });
                }}
                className="text-xs"
              >
                Download Original Images
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Images are automatically optimized to 2048px max dimensions and under 5MB during upload using smart quality compression
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};