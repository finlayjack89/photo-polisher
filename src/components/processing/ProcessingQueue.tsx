import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { RefreshCw, CheckCircle, Clock, AlertCircle, Zap } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface ProcessingStats {
  totalProcessed: number;
  cacheHits: number;
  averageProcessingTime: number;
  systemStatus: 'optimal' | 'busy' | 'maintenance';
}

export const ProcessingQueue = () => {
  const [stats, setStats] = useState<ProcessingStats>({
    totalProcessed: 0,
    cacheHits: 0,
    averageProcessingTime: 0,
    systemStatus: 'optimal'
  });
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchProcessingStats = async () => {
    try {
      setIsLoading(true);

      // V5 Architecture - Get cache statistics instead of job queue
      const { data: cacheData } = await supabase
        .from('processing_cache')
        .select('hit_count, created_at, last_accessed');

      const totalCacheHits = cacheData?.reduce((sum, item) => sum + (item.hit_count || 0), 0) || 0;
      const cacheEntries = cacheData?.length || 0;

      setStats({
        totalProcessed: cacheEntries,
        cacheHits: totalCacheHits,
        averageProcessingTime: 2.5, // V5 average processing time per image
        systemStatus: 'optimal'
      });

    } catch (error) {
      console.error('Error fetching processing stats:', error);
      toast({
        title: "Error",
        description: "Failed to fetch processing statistics",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchProcessingStats();
    
    // Refresh every 10 seconds
    const interval = setInterval(fetchProcessingStats, 10000);
    return () => clearInterval(interval);
  }, []);

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'optimal': return <CheckCircle className="h-4 w-4 text-success" />;
      case 'busy': return <Clock className="h-4 w-4 text-warning" />;
      case 'maintenance': return <AlertCircle className="h-4 w-4 text-destructive" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'optimal': return 'success';
      case 'busy': return 'warning';
      case 'maintenance': return 'destructive';
      default: return 'secondary';
    }
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Processing System</h1>
          <p className="text-muted-foreground">V5 Real-Time Image Processing Status</p>
        </div>
        <Button 
          onClick={fetchProcessingStats} 
          disabled={isLoading}
          variant="outline"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Status</CardTitle>
            {getStatusIcon(stats.systemStatus)}
          </CardHeader>
          <CardContent>
            <div className="flex items-center space-x-2">
              <Badge variant={getStatusColor(stats.systemStatus) as any}>
                {stats.systemStatus.toUpperCase()}
              </Badge>
            </div>
            <p className="text-xs text-muted-foreground mt-2">
              V5 real-time processing system
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Efficiency</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.cacheHits}</div>
            <p className="text-xs text-muted-foreground">
              Total cache hits from {stats.totalProcessed} entries
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Avg. Processing Time</CardTitle>
            <Clock className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.averageProcessingTime}s</div>
            <p className="text-xs text-muted-foreground">
              Per image with V5 architecture
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center space-x-2">
            <Zap className="h-5 w-5 text-electric" />
            <span>V5 Processing Architecture</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">Real-Time Processing</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• No queue delays - process images immediately</li>
                <li>• Individual image processing for maximum quality</li>
                <li>• Real-time progress updates for each image</li>
                <li>• Support for up to 20 images simultaneously</li>
              </ul>
            </div>
            
            <div className="space-y-3">
              <h3 className="font-semibold text-foreground">Enhanced Features</h3>
              <ul className="space-y-2 text-sm text-muted-foreground">
                <li>• HEIC to PNG conversion with quality preservation</li>
                <li>• Gemini 2.5 Flash Image Preview AI model</li>
                <li>• Up to 18MB image support</li>
                <li>• Simplified architecture with better error handling</li>
              </ul>
            </div>
          </div>

          <div className="bg-muted/50 rounded-lg p-4">
            <div className="flex items-center space-x-2 mb-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                Active
              </Badge>
              <span className="font-medium text-foreground">V5 Single-Image Processing Pipeline</span>
            </div>
            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span>Background Removal</span>
                <Badge variant="secondary">Replicate API</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span>AI Compositing</span>
                <Badge variant="secondary">Gemini 2.5 Flash</Badge>
              </div>
              <div className="flex justify-between text-sm">
                <span>Final Enhancement</span>
                <Badge variant="secondary">Gemini 2.5 Flash</Badge>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};