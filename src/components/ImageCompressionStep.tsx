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
          <h1 className="text-3xl font-bold mb-2">Image Analysis</h1>
          <p className="text-muted-foreground">
            We've analyzed your images to optimize processing performance
          </p>
        </div>

        <Card className="max-w-2xl mx-auto">
          <CardHeader className="text-center">
            <div className="flex items-center justify-center mb-4">
              <AlertCircle className="h-12 w-12 text-yellow-500" />
            </div>
            <CardTitle className="text-xl">
              {compressionAnalysis.needsResize ? 'Large Images Detected' : 'Image Optimization Recommended'}
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
                <span className="text-sm font-medium">Large Files (&gt;5MB):</span>
                <Badge variant={compressionAnalysis.largeFiles > 0 ? "destructive" : "secondary"}>
                  {compressionAnalysis.largeFiles}
                </Badge>
              </div>
              {compressionAnalysis.needsResize && (
                <div className="flex justify-between items-center">
                  <span className="text-sm font-medium">Max Dimension:</span>
                  <Badge variant="outline">
                    {compressionAnalysis.maxDimension}px recommended
                  </Badge>
                </div>
              )}
            </div>

            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-lg p-4">
              <div className="flex items-start gap-3">
                <Zap className="h-5 w-5 text-blue-500 mt-0.5" />
                <div>
                  <h4 className="font-medium text-blue-900 dark:text-blue-100 mb-1">
                    Recommended: Optimize Images
                  </h4>
                  <p className="text-sm text-blue-700 dark:text-blue-200">
                    {compressionAnalysis.needsResize 
                      ? 'Large image dimensions can cause memory issues during AI processing. We recommend resizing and compressing them.'
                      : 'Large file sizes can slow down processing. We recommend compressing them for optimal performance.'
                    }
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <Button 
                onClick={onCompress} 
                className="flex-1"
                disabled={isProcessing}
              >
                <Zap className="h-4 w-4 mr-2" />
                {isProcessing ? 'Processing...' : 'Optimize Images'}
              </Button>
              <Button 
                variant="outline" 
                onClick={onSkip}
                disabled={isProcessing}
              >
                Skip
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>

            <p className="text-xs text-muted-foreground text-center">
              Optimization includes resizing to 1024px max dimension and compression for Edge Function compatibility
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};