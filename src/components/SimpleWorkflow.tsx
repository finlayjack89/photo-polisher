import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { BackgroundRemovalStep } from "./BackgroundRemovalStep";
import { CanvasPositioning, PositioningData } from "./CanvasPositioning";
import { Card } from "./ui/card";
import { Button } from "./ui/button";

export type WorkflowStep = "upload" | "remove-bg" | "position" | "complete";

interface ImageData {
  file?: File;
  original: string;
  noBg?: string;
  backdrop?: string;
  compositeUrl?: string;
  positioningData?: PositioningData;
}

export const SimpleWorkflow = () => {
  const [currentStep, setCurrentStep] = useState<WorkflowStep>("upload");
  const [imageData, setImageData] = useState<ImageData>({ original: "" });

  const handleImageUpload = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setImageData({ file, original: reader.result as string });
        setCurrentStep("remove-bg");
      };
      reader.readAsDataURL(file);
    }
  };

  const handleBackgroundRemoved = (processedSubjects: any[]) => {
    if (processedSubjects.length > 0) {
      const subject = processedSubjects[0];
      setImageData(prev => ({
        ...prev,
        noBg: subject.backgroundRemovedData,
      }));
      setCurrentStep("position");
    }
  };

  const handleBackdropUpload = (files: File[]) => {
    if (files.length > 0) {
      const file = files[0];
      const reader = new FileReader();
      reader.onload = () => {
        setImageData(prev => ({ ...prev, backdrop: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePositioningComplete = (compositeUrl: string, positioningData: PositioningData) => {
    setImageData(prev => ({ 
      ...prev, 
      compositeUrl,
      positioningData 
    }));
    setCurrentStep("complete");
  };

  return (
    <div className="container mx-auto p-6 max-w-7xl">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">LuxSnap</h1>
        <p className="text-muted-foreground">Professional photo editing for modern commerce</p>
      </div>

      {currentStep === "upload" && (
        <Card className="p-8">
          <h2 className="text-2xl font-semibold mb-4">Step 1: Upload Image</h2>
          <UploadZone onFilesUploaded={handleImageUpload} />
        </Card>
      )}

      {currentStep === "remove-bg" && imageData.file && (
        <BackgroundRemovalStep
          files={[imageData.file]}
          onProcessingComplete={handleBackgroundRemoved}
          onContinue={(imgs) => {
            // This is called after user clicks continue
            const firstImg = imgs[0];
            if (firstImg) {
              setImageData(prev => ({
                ...prev,
                noBg: firstImg.backgroundRemovedData
              }));
            }
          }}
          onBack={() => setCurrentStep("upload")}
        />
      )}

      {currentStep === "position" && !imageData.backdrop && (
        <Card className="p-8">
          <h2 className="text-2xl font-semibold mb-4">Step 3: Upload Backdrop</h2>
          <UploadZone onFilesUploaded={handleBackdropUpload} />
        </Card>
      )}

      {currentStep === "position" && imageData.noBg && imageData.backdrop && (
        <CanvasPositioning
          subjectUrl={imageData.noBg}
          backdropUrl={imageData.backdrop}
          onComplete={handlePositioningComplete}
          onBack={() => {
            setImageData(prev => ({ ...prev, backdrop: undefined }));
          }}
        />
      )}

      {currentStep === "complete" && imageData.compositeUrl && (
        <Card className="p-8">
          <h2 className="text-2xl font-semibold mb-4">Final Result</h2>
          <div className="max-w-4xl mx-auto">
            <img src={imageData.compositeUrl} alt="Final composite" className="w-full rounded-lg shadow-lg" />
            <div className="mt-6 flex gap-4">
              <a
                href={imageData.compositeUrl}
                download="luxsnap-composite.png"
                className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-md text-center font-medium hover:opacity-90"
              >
                Download Image
              </a>
              <Button
                onClick={() => {
                  setImageData({ original: "" });
                  setCurrentStep("upload");
                }}
                variant="secondary"
                className="flex-1"
              >
                Start New
              </Button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
