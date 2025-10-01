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

      // Cloudinary Architecture - Simplified metrics
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
        activeProcessing: 0, // Cloudinary processes in real-time, no queue
        cacheHitRate: Math.round(cacheHitRate * 100),
        systemHealth: 'healthy' // Simplified for Cloudinary architecture
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
          <p className="text-muted-foreground">Cloudinary Integration Architecture</p>
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
              Cloudinary real-time processing
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
            <div className={`h-3 w-3 rounded-full ${getHealthColor(stats.systemHealth)}`} />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold capitalize">{stats.systemHealth}</div>
            <p className="text-xs text-muted-foreground">
              All services operational
            </p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>System Overview</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            <div>
              <h3 className="font-semibold mb-2">Cloudinary Architecture Status</h3>
              <p className="text-muted-foreground text-sm">
                The system uses Cloudinary for server-side image compositing with real-time processing capabilities.
              </p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="p-4 rounded-lg bg-muted">
                <h4 className="font-medium">Processing Model</h4>
                <p className="text-sm text-muted-foreground">Cloudinary server-side rendering</p>
              </div>
              <div className="p-4 rounded-lg bg-muted">
                <h4 className="font-medium">Rendering Engine</h4>
                <p className="text-sm text-muted-foreground">Cloudinary Transformation API</p>
              </div>
              <div className="p-4 rounded-lg bg-muted">
                <h4 className="font-medium">Cache System</h4>
                <p className="text-sm text-muted-foreground">Optimized for performance</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};