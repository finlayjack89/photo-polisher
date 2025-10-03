import { useState } from "react";
import { UploadZone } from "./UploadZone";
import { BackgroundRemovalStep } from "./BackgroundRemovalStep";
import { CloudinaryPositioning } from "./CloudinaryPositioning";
import { ProcessingStep } from "./ProcessingStep";
import { Card } from "./ui/card";

export type WorkflowStep = "upload" | "remove-bg" | "position" | "processing" | "complete";

interface ImageData {
  file?: File;
  original: string;
  noBg?: string;
  cloudinaryId?: string;
  backdrop?: string;
  finalUrl?: string;
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
        cloudinaryId: subject.cloudinaryPublicId || ""
      }));
      setCurrentStep("position");
    }
  };

  const handlePositioningComplete = (backdropUrl: string) => {
    setImageData(prev => ({ ...prev, backdrop: backdropUrl }));
    setCurrentStep("processing");
  };

  const handleFinalRender = (finalUrl: string) => {
    setImageData(prev => ({ ...prev, finalUrl }));
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

      {currentStep === "position" && imageData.noBg && imageData.cloudinaryId && (
        <CloudinaryPositioning
          subjectUrl={imageData.noBg}
          subjectCloudinaryId={imageData.cloudinaryId}
          onComplete={handlePositioningComplete}
          onBack={() => setCurrentStep("remove-bg")}
        />
      )}

      {currentStep === "processing" && (
        <ProcessingStep
          subjectCloudinaryId={imageData.cloudinaryId!}
          backdropUrl={imageData.backdrop!}
          onComplete={handleFinalRender}
        />
      )}

      {currentStep === "complete" && imageData.finalUrl && (
        <Card className="p-8">
          <h2 className="text-2xl font-semibold mb-4">Final Result</h2>
          <div className="max-w-4xl mx-auto">
            <img src={imageData.finalUrl} alt="Final render" className="w-full rounded-lg shadow-lg" />
            <div className="mt-6 flex gap-4">
              <a
                href={imageData.finalUrl}
                download="luxsnap-render.png"
                className="flex-1 px-6 py-3 bg-primary text-primary-foreground rounded-md text-center font-medium hover:opacity-90"
              >
                Download Image
              </a>
              <button
                onClick={() => {
                  setImageData({ original: "" });
                  setCurrentStep("upload");
                }}
                className="px-6 py-3 bg-secondary text-secondary-foreground rounded-md font-medium hover:opacity-90"
              >
                Start New
              </button>
            </div>
          </div>
        </Card>
      )}
    </div>
  );
};
