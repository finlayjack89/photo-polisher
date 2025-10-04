import { useEffect, useRef, useState } from "react";
import { Card } from "./ui/card";
import { Button } from "./ui/button";
import { Slider } from "./ui/slider";
import { toast } from "@/hooks/use-toast";

interface CanvasPositioningProps {
  subjectUrl: string;
  backdropUrl: string;
  onComplete: (compositeDataUrl: string, positioningData: PositioningData) => void;
  onBack: () => void;
  existingPositioning?: PositioningData;
}

export interface PositioningData {
  x: number; // Normalized 0-1
  y: number; // Normalized 0-1
  scale: number; // 0-1
  canvasWidth: number;
  canvasHeight: number;
}

export const CanvasPositioning = ({
  subjectUrl,
  backdropUrl,
  onComplete,
  onBack,
  existingPositioning,
}: CanvasPositioningProps) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [backdropImg, setBackdropImg] = useState<HTMLImageElement | null>(null);
  const [subjectImg, setSubjectImg] = useState<HTMLImageElement | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isDragging, setIsDragging] = useState(false);
  
  const [position, setPosition] = useState({ x: 0.5, y: 0.5 });
  const [scale, setScale] = useState(0.5);

  const CANVAS_SIZE = 2048;

  // Load images
  useEffect(() => {
    const loadImages = async () => {
      try {
        const backdrop = new Image();
        backdrop.crossOrigin = "anonymous";
        backdrop.src = backdropUrl;
        
        const subject = new Image();
        subject.crossOrigin = "anonymous";
        subject.src = subjectUrl;

        await Promise.all([
          new Promise((resolve, reject) => {
            backdrop.onload = resolve;
            backdrop.onerror = reject;
          }),
          new Promise((resolve, reject) => {
            subject.onload = resolve;
            subject.onerror = reject;
          }),
        ]);

        setBackdropImg(backdrop);
        setSubjectImg(subject);
        
        // Apply existing positioning if provided
        if (existingPositioning) {
          setPosition({ x: existingPositioning.x, y: existingPositioning.y });
          setScale(existingPositioning.scale);
        }
        
        setIsLoading(false);
        toast({ title: "Images loaded", description: "Drag to position the subject" });
      } catch (error) {
        console.error("Error loading images:", error);
        toast({
          title: "Error",
          description: "Failed to load images",
          variant: "destructive",
        });
      }
    };

    loadImages();
  }, [subjectUrl, backdropUrl, existingPositioning]);

  // Draw composite on canvas
  const drawComposite = () => {
    if (!canvasRef.current || !backdropImg || !subjectImg) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Clear canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw backdrop (fills entire canvas)
    ctx.drawImage(backdropImg, 0, 0, CANVAS_SIZE, CANVAS_SIZE);

    // Calculate subject dimensions maintaining aspect ratio
    const subjectWidth = CANVAS_SIZE * scale;
    const subjectHeight = (subjectWidth / subjectImg.width) * subjectImg.height;

    // Calculate subject position (centered on x, y)
    const subjectX = position.x * CANVAS_SIZE - subjectWidth / 2;
    const subjectY = position.y * CANVAS_SIZE - subjectHeight / 2;

    // Draw subject
    ctx.drawImage(subjectImg, subjectX, subjectY, subjectWidth, subjectHeight);
  };

  // Redraw whenever position or scale changes
  useEffect(() => {
    if (!isLoading) {
      drawComposite();
    }
  }, [position, scale, isLoading, backdropImg, subjectImg]);

  // Mouse drag handlers
  const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    setIsDragging(true);
    updatePosition(e);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      updatePosition(e);
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const updatePosition = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;

    setPosition({
      x: Math.max(0, Math.min(1, x)),
      y: Math.max(0, Math.min(1, y)),
    });
  };

  const handleContinue = () => {
    if (!canvasRef.current) return;

    try {
      // Export canvas as PNG data URL
      const dataUrl = canvasRef.current.toDataURL("image/png", 1.0);

      const positioningData: PositioningData = {
        x: position.x,
        y: position.y,
        scale: scale,
        canvasWidth: CANVAS_SIZE,
        canvasHeight: CANVAS_SIZE,
      };

      onComplete(dataUrl, positioningData);
      toast({ title: "Success", description: "Image composited successfully" });
    } catch (error) {
      console.error("Error exporting canvas:", error);
      toast({
        title: "Error",
        description: "Failed to export composite image",
        variant: "destructive",
      });
    }
  };

  return (
    <Card className="p-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold">Position Your Subject</h2>
          <p className="text-muted-foreground mt-1">
            Drag to position, use slider to scale
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-96">
          <p className="text-muted-foreground">Loading images...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Canvas Preview */}
          <div className="relative bg-muted rounded-lg overflow-hidden">
            <canvas
              ref={canvasRef}
              width={CANVAS_SIZE}
              height={CANVAS_SIZE}
              className="w-full h-auto cursor-move"
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseUp}
            />
          </div>

          {/* Scale Control */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Subject Scale</label>
            <Slider
              value={[scale]}
              onValueChange={([value]) => setScale(value)}
              min={0.1}
              max={1.0}
              step={0.01}
              className="w-full"
            />
            <p className="text-xs text-muted-foreground">
              Current scale: {Math.round(scale * 100)}%
            </p>
          </div>

          {/* Navigation Buttons */}
          <div className="flex gap-4">
            <Button variant="outline" onClick={onBack} className="flex-1">
              Back
            </Button>
            <Button onClick={handleContinue} className="flex-1">
              Continue
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
};
