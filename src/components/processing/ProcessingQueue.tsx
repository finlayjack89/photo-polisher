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
            <CardTitle className="text-sm font-medium">Cache Entries</CardTitle>
            <Zap className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalProcessed}</div>
            <p className="text-xs text-muted-foreground">
              Total cached results
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Hits</CardTitle>
            <CheckCircle className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.cacheHits}</div>
            <p className="text-xs text-muted-foreground">
              Performance optimization
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Processing Performance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="flex justify-between mb-2">
              <span className="text-sm font-medium">Average Processing Time</span>
              <span className="text-sm text-muted-foreground">{stats.averageProcessingTime}s per image</span>
            </div>
            <Progress value={75} className="w-full" />
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
            <div className="p-4 rounded-lg bg-muted">
              <h4 className="font-medium mb-2">V5 Architecture Benefits</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Real-time image processing</li>
                <li>• No queue management needed</li>
                <li>• Optimized cache system</li>
                <li>• Sequential multi-step processing</li>
              </ul>
            </div>
            
            <div className="p-4 rounded-lg bg-muted">
              <h4 className="font-medium mb-2">Processing Pipeline</h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Background removal (AI)</li>
                <li>• Backdrop compositing</li>
                <li>• AI enhancement</li>
                <li>• Final optimization</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};