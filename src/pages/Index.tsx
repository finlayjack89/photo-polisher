import { useState } from "react";
import { Upload, Sparkles, Image as ImageIcon, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UploadZone } from "@/components/UploadZone";
import { ProcessingWorkflow } from "@/components/ProcessingWorkflow";
import { GalleryPreview } from "@/components/GalleryPreview";
import heroImage from "@/assets/hero-studio.jpg";

const Index = () => {
  const [currentStep, setCurrentStep] = useState<'upload' | 'processing' | 'gallery'>('upload');
  const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
  const [processedFiles, setProcessedFiles] = useState<any[]>([]);

  const handleFilesUploaded = (files: File[]) => {
    setUploadedFiles(files);
    setCurrentStep('processing');
  };

  const handleProcessingComplete = (processed: any[]) => {
    setProcessedFiles(processed);
    setCurrentStep('gallery');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border/50 bg-card/50 backdrop-blur-sm sticky top-0 z-50">
        <div className="container mx-auto px-6 py-4 flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-8 h-8 bg-gradient-electric rounded-lg flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-electric-foreground" />
            </div>
            <h1 className="text-xl font-bold text-foreground">LuxSnap</h1>
          </div>
          <div className="flex items-center space-x-4">
            <Button variant="ghost" size="sm">Sign In</Button>
            <Button variant="electric" size="sm">Get Started</Button>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      {currentStep === 'upload' && (
        <section className="relative overflow-hidden">
          <div className="absolute inset-0">
            <img 
              src={heroImage} 
              alt="Professional photography studio" 
              className="w-full h-full object-cover opacity-20"
            />
            <div className="absolute inset-0 bg-gradient-to-b from-background/80 via-background/60 to-background/90" />
          </div>
          
          <div className="relative container mx-auto px-6 py-20 text-center">
            <div className="max-w-4xl mx-auto">
              <h2 className="text-5xl font-bold text-foreground mb-6">
                Transform Your Product Photos Into
                <span className="bg-gradient-electric bg-clip-text text-transparent"> Studio Quality</span>
              </h2>
              <p className="text-xl text-muted-foreground mb-8 max-w-2xl mx-auto">
                Professional background removal, AI-powered compositing, and studio lighting in seconds. 
                Perfect for resellers and e-commerce shops.
              </p>
              
              <div className="flex items-center justify-center space-x-8 mb-12">
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Upload className="w-5 h-5 text-electric" />
                  <span>Batch Upload</span>
                </div>
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <ImageIcon className="w-5 h-5 text-electric" />
                  <span>AI Background Removal</span>
                </div>
                <div className="flex items-center space-x-2 text-muted-foreground">
                  <Zap className="w-5 h-5 text-electric" />
                  <span>Studio Lighting</span>
                </div>
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Main Content */}
      <main className="container mx-auto px-6 py-8">
        {currentStep === 'upload' && (
          <UploadZone onFilesUploaded={handleFilesUploaded} />
        )}
        
        {currentStep === 'processing' && (
          <ProcessingWorkflow 
            files={uploadedFiles}
            onComplete={handleProcessingComplete}
          />
        )}
        
        {currentStep === 'gallery' && (
          <GalleryPreview 
            files={processedFiles}
            onBack={() => setCurrentStep('upload')}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-border/50 bg-card/30 backdrop-blur-sm mt-20">
        <div className="container mx-auto px-6 py-8">
          <div className="text-center text-muted-foreground">
            <p>&copy; 2024 LuxSnap. Professional photo editing for modern commerce.</p>
          </div>
        </div>
      </footer>
    </div>
  );
};

export default Index;