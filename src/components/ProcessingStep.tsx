import { useEffect, useState } from "react";
import { Card } from "./ui/card";
import { Progress } from "./ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

interface ProcessingStepProps {
  subjectCloudinaryId: string;
  backdropUrl: string;
  onComplete: (finalUrl: string) => void;
}

export const ProcessingStep = ({ subjectCloudinaryId, backdropUrl, onComplete }: ProcessingStepProps) => {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState("Preparing to render...");

  useEffect(() => {
    const renderFinal = async () => {
      try {
        setProgress(20);
        setStatus("Parsing positioning data...");
        
        const positionData = JSON.parse(backdropUrl);
        
        setProgress(40);
        setStatus("Compositing subject with backdrop...");
        
        // Call edge function to render final composite
        const { data, error } = await supabase.functions.invoke('render-final-composite', {
          body: positionData,
        });

        if (error) throw error;
        
        setProgress(80);
        setStatus("Adding shadows and reflection...");
        
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        setProgress(100);
        setStatus("Complete!");
        
        onComplete(data.url);
      } catch (error) {
        console.error("Error rendering final composite:", error);
        toast({
          title: "Error",
          description: "Failed to render final image",
          variant: "destructive",
        });
      }
    };

    renderFinal();
  }, [subjectCloudinaryId, backdropUrl, onComplete]);

  return (
    <Card className="p-8">
      <h2 className="text-2xl font-semibold mb-4">Generating Your Final Image</h2>
      <div className="space-y-4">
        <Progress value={progress} className="w-full" />
        <p className="text-center text-muted-foreground">{status}</p>
      </div>
    </Card>
  );
};
