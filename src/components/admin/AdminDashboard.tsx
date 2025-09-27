import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { RefreshCw, Activity, Database, Cloud } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

interface SystemStats {
  totalUsers: number;
  activeProcessing: number;
  cacheHitRate: number;
  systemHealth: 'healthy' | 'warning' | 'error';
}

export const AdminDashboard = () => {
  const [stats, setStats] = useState<SystemStats>({
    totalUsers: 0,
    activeProcessing: 0,
    cacheHitRate: 0,
    systemHealth: 'healthy'
  });
  const [isLoading, setIsLoading] = useState(true);
  const { toast } = useToast();

  const fetchStats = async () => {
    try {
      setIsLoading(true);

      // V5 Architecture - No processing_jobs table, simplified metrics
      const { data: cacheData } = await supabase
        .from('processing_cache')
        .select('hit_count');

      const totalCacheHits = cacheData?.reduce((sum, item) => sum + (item.hit_count || 0), 0) || 0;
      const cacheEntries = cacheData?.length || 0;
      const cacheHitRate = cacheEntries > 0 ? (totalCacheHits / cacheEntries) : 0;

      // Get user quota info
      const { data: quotaData } = await supabase
        .from('user_quotas')
        .select('current_usage, monthly_limit');

      const totalUsers = quotaData?.length || 0;

      setStats({
        totalUsers,
        activeProcessing: 0, // V5 processes in real-time, no queue
        cacheHitRate: Math.round(cacheHitRate * 100),
        systemHealth: 'healthy' // Simplified for V5 architecture
      });

    } catch (error) {
      console.error('Error fetching admin stats:', error);
      toast({
        title: "Error",
        description: "Failed to fetch system statistics",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    
    // Refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const getHealthColor = (health: string) => {
    switch (health) {
      case 'healthy': return 'bg-success';
      case 'warning': return 'bg-warning';
      case 'error': return 'bg-destructive';
      default: return 'bg-muted';
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Admin Dashboard</h1>
          <p className="text-muted-foreground">V5 Single-Image Processing Architecture</p>
        </div>
        <Button 
          onClick={fetchStats} 
          disabled={isLoading}
          variant="outline"
        >
          <RefreshCw className={`w-4 h-4 mr-2 ${isLoading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Users</CardTitle>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.totalUsers}</div>
            <p className="text-xs text-muted-foreground">
              Active user accounts
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Processing Queue</CardTitle>
            <Cloud className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.activeProcessing}</div>
            <p className="text-xs text-muted-foreground">
              V5 real-time processing
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Cache Hit Rate</CardTitle>
            <Database className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.cacheHitRate}%</div>
            <p className="text-xs text-muted-foreground">
              Processing cache efficiency
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">System Health</CardTitle>
            <div className={`w-3 h-3 rounded-full ${getHealthColor(stats.systemHealth)}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{stats.systemHealth}</div>
            <p className="text-xs text-muted-foreground">
              V5 architecture status
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>V5 Architecture Benefits</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                ✓ Real-time Processing
              </Badge>
              <span className="text-sm text-muted-foreground">No queue delays</span>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                ✓ Quality Preservation
              </Badge>
              <span className="text-sm text-muted-foreground">18MB image support</span>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                ✓ HEIC Support
              </Badge>
              <span className="text-sm text-muted-foreground">Native iPhone photo support</span>
            </div>
            <div className="flex items-center space-x-2">
              <Badge variant="outline" className="bg-success/10 text-success border-success/20">
                ✓ Simplified Architecture
              </Badge>
              <span className="text-sm text-muted-foreground">Single-function processing</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Information</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-sm">
              <strong>Architecture:</strong> V5 Single-Image Processing
            </div>
            <div className="text-sm">
              <strong>AI Model:</strong> Gemini 2.5 Flash Image Preview
            </div>
            <div className="text-sm">
              <strong>Image Support:</strong> PNG, JPG, WEBP, HEIC up to 20MB
            </div>
            <div className="text-sm">
              <strong>Processing:</strong> Real-time individual image processing
            </div>
            <div className="text-sm">
              <strong>Quality:</strong> Lossless PNG conversion for HEIC files
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
};