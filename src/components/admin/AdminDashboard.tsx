import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle, Clock, X, RefreshCw, Activity, Users, Database, HardDrive } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface QueueStats {
  pending: number;
  processing: number;
  completed: number;
  failed: number;
  cancelled: number;
  total: number;
}

interface ProcessingJob {
  id: string;
  user_id: string;
  operation: string;
  status: string;
  original_image_url: string;
  processed_image_url?: string;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  metadata: any;
}

interface SystemHealth {
  [key: string]: {
    values: number[];
    latest: number;
    average: number;
  };
}

export function AdminDashboard() {
  const [queueStats, setQueueStats] = useState<QueueStats | null>(null);
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [systemHealth, setSystemHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadDashboardData();
    // Set up real-time subscription for jobs
    const channel = supabase
      .channel('admin-dashboard')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'processing_jobs'
      }, () => {
        loadDashboardData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadDashboardData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadQueueStats(),
        loadRecentJobs(),
        loadSystemHealth()
      ]);
    } catch (error) {
      console.error('Error loading dashboard data:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load dashboard data"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadQueueStats = async () => {
    const { data, error } = await supabase.functions.invoke('processing-queue', {
      body: new URLSearchParams({ action: 'status' })
    });

    if (error) throw error;
    setQueueStats(data.queue_stats);
  };

  const loadRecentJobs = async () => {
    const { data, error } = await supabase
      .from('processing_jobs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    if (error) throw error;
    setJobs(data || []);
  };

  const loadSystemHealth = async () => {
    const { data, error } = await supabase.functions.invoke('processing-queue', {
      body: new URLSearchParams({ action: 'health' })
    });

    if (error) throw error;
    setSystemHealth(data.health_metrics);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadDashboardData();
    setRefreshing(false);
    toast({
      title: "Success",
      description: "Dashboard data refreshed"
    });
  };

  const handleProcessQueue = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('processing-queue', {
        body: new URLSearchParams({ action: 'process' })
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: data.message
      });

      await loadDashboardData();
    } catch (error) {
      console.error('Error processing queue:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to process queue"
      });
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      const { error } = await supabase.functions.invoke('processing-queue', {
        body: new URLSearchParams({ action: 'cancel', job_id: jobId })
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Job cancelled successfully"
      });

      await loadDashboardData();
    } catch (error) {
      console.error('Error cancelling job:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to cancel job"
      });
    }
  };

  const handleRetryJob = async (jobId: string) => {
    try {
      const { error } = await supabase.functions.invoke('processing-queue', {
        body: new URLSearchParams({ action: 'retry', job_id: jobId })
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "Job queued for retry"
      });

      await loadDashboardData();
    } catch (error) {
      console.error('Error retrying job:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to retry job"
      });
    }
  };

  const handleCleanup = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-scheduler');

      if (error) throw error;

      toast({
        title: "Success",
        description: `Cleanup completed: ${JSON.stringify(data.results)}`
      });

      await loadDashboardData();
    } catch (error) {
      console.error('Error running cleanup:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to run cleanup"
      });
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return <Badge variant="secondary" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1" />Completed</Badge>;
      case 'processing':
        return <Badge variant="secondary" className="bg-blue-100 text-blue-800"><Clock className="w-3 h-3 mr-1" />Processing</Badge>;
      case 'failed':
        return <Badge variant="destructive"><AlertCircle className="w-3 h-3 mr-1" />Failed</Badge>;
      case 'cancelled':
        return <Badge variant="outline"><X className="w-3 h-3 mr-1" />Cancelled</Badge>;
      default:
        return <Badge variant="outline"><Clock className="w-3 h-3 mr-1" />Pending</Badge>;
    }
  };

  if (loading) {
    return (
      <div className="container mx-auto p-6">
        <div className="flex items-center justify-center min-h-[400px]">
          <div className="text-center">
            <RefreshCw className="w-8 h-8 animate-spin mx-auto mb-4 text-muted-foreground" />
            <p className="text-muted-foreground">Loading dashboard...</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Admin Dashboard</h1>
          <p className="text-muted-foreground">Monitor and manage image processing operations</p>
        </div>
        <div className="flex gap-2">
          <Button 
            onClick={handleRefresh} 
            disabled={refreshing}
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
          <Button onClick={handleProcessQueue}>
            Process Queue
          </Button>
          <Button variant="outline" onClick={handleCleanup}>
            Run Cleanup
          </Button>
        </div>
      </div>

      {/* Overview Stats */}
      {queueStats && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Total Jobs</CardTitle>
              <Activity className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{queueStats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Pending</CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-yellow-600">{queueStats.pending}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Processing</CardTitle>
              <RefreshCw className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-blue-600">{queueStats.processing}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">Completed</CardTitle>
              <CheckCircle className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-green-600">{queueStats.completed}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Tabs defaultValue="jobs" className="space-y-4">
        <TabsList>
          <TabsTrigger value="jobs">Processing Jobs</TabsTrigger>
          <TabsTrigger value="health">System Health</TabsTrigger>
        </TabsList>

        <TabsContent value="jobs">
          <Card>
            <CardHeader>
              <CardTitle>Recent Processing Jobs</CardTitle>
              <CardDescription>Latest 50 processing jobs across all users</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {jobs.map((job) => (
                  <div key={job.id} className="flex items-center justify-between p-4 border rounded-lg">
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center space-x-2">
                        {getStatusBadge(job.status)}
                        <span className="font-medium">{job.operation}</span>
                        <span className="text-sm text-muted-foreground">#{job.id.slice(0, 8)}</span>
                      </div>
                      <div className="text-sm text-muted-foreground">
                        Created: {new Date(job.created_at).toLocaleString()}
                        {job.completed_at && (
                          <> • Completed: {new Date(job.completed_at).toLocaleString()}</>
                        )}
                      </div>
                      {job.error_message && (
                        <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                          {job.error_message}
                        </div>
                      )}
                    </div>
                    <div className="flex space-x-2">
                      {job.status === 'failed' && (
                        <Button size="sm" variant="outline" onClick={() => handleRetryJob(job.id)}>
                          <RefreshCw className="w-3 h-3 mr-1" />
                          Retry
                        </Button>
                      )}
                      {['pending', 'processing'].includes(job.status) && (
                        <Button size="sm" variant="outline" onClick={() => handleCancelJob(job.id)}>
                          <X className="w-3 h-3 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
                {jobs.length === 0 && (
                  <div className="text-center py-8 text-muted-foreground">
                    No processing jobs found
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="health">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>System Health Metrics</CardTitle>
                <CardDescription>Recent performance indicators</CardDescription>
              </CardHeader>
              <CardContent>
                {systemHealth ? (
                  <div className="space-y-4">
                    {Object.entries(systemHealth).map(([metric, data]) => (
                      <div key={metric} className="space-y-2">
                        <div className="flex justify-between text-sm">
                          <span className="font-medium">{metric.replace(/_/g, ' ').toUpperCase()}</span>
                          <span>{data.latest}</span>
                        </div>
                        <Progress value={Math.min((data.average / data.latest) * 100, 100)} />
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    No health metrics available
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Storage Usage</CardTitle>
                <CardDescription>Current storage statistics</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="flex items-center space-x-2">
                    <HardDrive className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Original Images</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <HardDrive className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Processed Images</span>
                  </div>
                  <div className="flex items-center space-x-2">
                    <HardDrive className="w-4 h-4 text-muted-foreground" />
                    <span className="text-sm">Thumbnails</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}