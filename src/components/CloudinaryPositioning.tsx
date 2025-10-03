import { useState, useEffect } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "@/hooks/use-toast";
import { Upload } from "lucide-react";

interface CloudinaryPositioningProps {
  subjectUrl: string;
  subjectCloudinaryId: string;
  onComplete: (backdropUrl: string) => void;
  onBack: () => void;
}

export const CloudinaryPositioning = ({
  subjectUrl,
  subjectCloudinaryId,
  onComplete,
  onBack,
}: CloudinaryPositioningProps) => {
  const [backdropFile, setBackdropFile] = useState<File | null>(null);
  const [backdropPreview, setBackdropPreview] = useState<string>("");
  const [backdropCloudinaryId, setBackdropCloudinaryId] = useState<string>("");
  const [isUploadingBackdrop, setIsUploadingBackdrop] = useState(false);
  
  // Position and scale state (0-1 normalized)
  const [position, setPosition] = useState({ x: 0.5, y: 0.7 });
  const [scale, setScale] = useState(0.5);
  
  // Canvas dimensions
  const CANVAS_WIDTH = 2048;
  const CANVAS_HEIGHT = 2048;
  
  // Dragging state
  const [isDragging, setIsDragging] = useState(false);

  const handleBackdropUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast({ title: "Error", description: "Please upload an image file", variant: "destructive" });
      return;
    }

    setIsUploadingBackdrop(true);
    setBackdropFile(file);
    
    // Create preview
    const reader = new FileReader();
    reader.onload = (e) => {
      setBackdropPreview(e.target?.result as string);
    };
    reader.readAsDataURL(file);

    try {
      // Upload to Cloudinary
      const { uploadToCloudinary } = await import("@/lib/cloudinary-render");
      const dataUrl = await new Promise<string>((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.readAsDataURL(file);
      });
      
      const result = await uploadToCloudinary(dataUrl, "backdrop", "user-id");
      setBackdropCloudinaryId(result.public_id);
      
      toast({ title: "Success", description: "Backdrop uploaded successfully" });
    } catch (error) {
      console.error("Error uploading backdrop:", error);
      toast({ title: "Error", description: "Failed to upload backdrop", variant: "destructive" });
    } finally {
      setIsUploadingBackdrop(false);
    }
  };

  // Build real-time Cloudinary preview URL
  const buildPreviewUrl = () => {
    if (!backdropCloudinaryId || !subjectCloudinaryId) return "";
    
    // Calculate pixel positions from normalized values
    const subjectCenterX = Math.round(position.x * CANVAS_WIDTH);
    const subjectCenterY = Math.round(position.y * CANVAS_HEIGHT);
    const subjectWidth = Math.round(CANVAS_WIDTH * scale);
    
    // Cloudinary coordinate system: (0,0) is center, x+ is right, y+ is down
    const xOffset = subjectCenterX - (CANVAS_WIDTH / 2);
    const yOffset = subjectCenterY - (CANVAS_HEIGHT / 2);
    
    // Build transformation: backdrop FILLS entire canvas (c_fill), subject overlaid
    const transformations = [
      `w_${CANVAS_WIDTH},h_${CANVAS_HEIGHT},c_fill,f_png`,
      `l_${subjectCloudinaryId.replace(/\//g, ':')},c_fit,w_${subjectWidth},g_center,x_${xOffset},y_${yOffset},fl_layer_apply`
    ].join('/');
    
    return `https://res.cloudinary.com/dkbz3p4li/image/upload/${transformations}/${backdropCloudinaryId}`;
  };

  const previewUrl = buildPreviewUrl();

  const handleMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    setIsDragging(true);
    handleMouseMove(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDragging && e.type !== "mousedown") return;
    
    const rect = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    
    setPosition({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y))
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener("mouseup", handleMouseUp);
      return () => window.removeEventListener("mouseup", handleMouseUp);
    }
  }, [isDragging]);

  const handleContinue = () => {
    if (!backdropCloudinaryId) {
      toast({ title: "Error", description: "Please upload a backdrop", variant: "destructive" });
      return;
    }
    
    // Pass positioning data to next step
    onComplete(JSON.stringify({
      backdropCloudinaryId,
      subjectCloudinaryId,
      position,
      scale,
      canvasWidth: CANVAS_WIDTH,
      canvasHeight: CANVAS_HEIGHT,
    }));
  };

  return (
    <div className="space-y-6">
      <Card className="p-6">
        <h2 className="text-2xl font-semibold mb-4">Step 2: Position Your Product</h2>
        
        {!backdropFile ? (
          <div className="border-2 border-dashed border-border rounded-lg p-12 text-center">
            <Upload className="w-12 h-12 mx-auto mb-4 text-muted-foreground" />
            <p className="text-lg mb-4">Upload Your Backdrop</p>
            <Input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleBackdropUpload(file);
              }}
              className="max-w-xs mx-auto"
            />
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Controls */}
            <div className="space-y-6">
              <div>
                <Label>Product Scale: {Math.round(scale * 100)}%</Label>
                <Slider
                  value={[scale]}
                  onValueChange={([val]) => setScale(val)}
                  min={0.1}
                  max={1}
                  step={0.01}
                  className="mt-2"
                />
              </div>
              
              <div className="p-4 bg-muted rounded-lg">
                <h3 className="font-semibold mb-2">How to Position:</h3>
                <ul className="text-sm space-y-1 text-muted-foreground">
                  <li>• Click and drag on the preview to move your product</li>
                  <li>• Use the slider to adjust product size</li>
                  <li>• Backdrop remains fixed and static</li>
                  <li>• Real-time preview shows exact placement</li>
                </ul>
              </div>

              <div className="text-sm text-muted-foreground">
                <p>Position: ({Math.round(position.x * 100)}%, {Math.round(position.y * 100)}%)</p>
              </div>

              <div className="flex gap-3">
                <Button variant="outline" onClick={onBack}>
                  Back
                </Button>
                <Button onClick={handleContinue} className="flex-1">
                  Continue to Render
                </Button>
              </div>
            </div>

            {/* Preview */}
            <div className="space-y-2">
              <Label>Real-Time Preview</Label>
              <div
                className="relative w-full aspect-square bg-muted rounded-lg overflow-hidden cursor-move select-none"
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
                onMouseLeave={() => setIsDragging(false)}
              >
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full h-full object-contain pointer-events-none"
                    draggable={false}
                  />
                ) : (
                  <div className="flex items-center justify-center h-full">
                    <p className="text-muted-foreground">Loading preview...</p>
                  </div>
                )}
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Drag to position • Backdrop stays fixed
              </p>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
};
