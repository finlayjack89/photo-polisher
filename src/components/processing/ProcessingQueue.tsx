import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { AlertCircle, CheckCircle, Clock, X, RefreshCw, Image, Upload } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";

interface ProcessingJob {
  id: string;
  operation: string;
  status: string;
  original_image_url: string;
  processed_image_url?: string;
  thumbnail_url?: string;
  error_message?: string;
  created_at: string;
  started_at?: string;
  completed_at?: string;
  metadata: any;
}

interface UserQuota {
  monthly_limit: number;
  current_usage: number;
  reset_date: string;
}

export function ProcessingQueue() {
  const [jobs, setJobs] = useState<ProcessingJob[]>([]);
  const [quota, setQuota] = useState<UserQuota | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadUserData();
    
    // Set up real-time subscription for user's jobs
    const channel = supabase
      .channel('user-processing-jobs')
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'processing_jobs',
        filter: `user_id=eq.${supabase.auth.getUser().then(u => u.data.user?.id)}`
      }, () => {
        loadUserData();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const loadUserData = async () => {
    try {
      setLoading(true);
      await Promise.all([
        loadUserJobs(),
        loadUserQuota()
      ]);
    } catch (error) {
      console.error('Error loading user data:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to load processing data"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadUserJobs = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data, error } = await supabase
      .from('processing_jobs')
      .select('*')
      .eq('user_id', user.user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    setJobs(data || []);
  };

  const loadUserQuota = async () => {
    const { data: user } = await supabase.auth.getUser();
    if (!user.user) return;

    const { data, error } = await supabase
      .from('user_quotas')
      .select('*')
      .eq('user_id', user.user.id)
      .single();

    if (error && error.code !== 'PGRST116') throw error;
    setQuota(data);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await loadUserData();
    setRefreshing(false);
    toast({
      title: "Success",
      description: "Processing queue refreshed"
    });
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

      await loadUserData();
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

      await loadUserData();
    } catch (error) {
      console.error('Error retrying job:', error);
      toast({
        variant: "destructive",
        title: "Error",
        description: "Failed to retry job"
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

  const getProcessingDuration = (job: ProcessingJob) => {
    if (!job.started_at) return null;
    
    const start = new Date(job.started_at);
    const end = job.completed_at ? new Date(job.completed_at) : new Date();
    const duration = Math.round((end.getTime() - start.getTime()) / 1000);
    
    return `${duration}s`;
  };

  const quotaPercentage = quota ? (quota.current_usage / quota.monthly_limit) * 100 : 0;

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[200px]">
        <div className="text-center">
          <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Loading processing queue...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">Processing Queue</h2>
          <p className="text-muted-foreground">Monitor your image processing jobs</p>
        </div>
        <Button onClick={handleRefresh} disabled={refreshing}>
          <RefreshCw className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {/* Quota Usage */}
      {quota && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Monthly Usage</CardTitle>
            <CardDescription>
              {quota.current_usage} of {quota.monthly_limit} images processed this month
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Progress value={quotaPercentage} className="w-full" />
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>{quota.current_usage} used</span>
                <span>{quota.monthly_limit - quota.current_usage} remaining</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Resets on {new Date(quota.reset_date).toLocaleDateString()}
              </p>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Processing Jobs */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Your Processing Jobs</CardTitle>
          <CardDescription>Recent image processing requests</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-4">
            {jobs.map((job) => (
              <div key={job.id} className="flex items-center space-x-4 p-4 border rounded-lg">
                <div className="flex-shrink-0">
                  {job.processed_image_url || job.thumbnail_url ? (
                    <img 
                      src={job.processed_image_url || job.thumbnail_url} 
                      alt="Processed" 
                      className="w-12 h-12 rounded object-cover"
                    />
                  ) : (
                    <div className="w-12 h-12 bg-muted rounded flex items-center justify-center">
                      <Image className="w-6 h-6 text-muted-foreground" />
                    </div>
                  )}
                </div>
                
                <div className="flex-1 space-y-1">
                  <div className="flex items-center space-x-2">
                    {getStatusBadge(job.status)}
                    <span className="font-medium capitalize">{job.operation}</span>
                    <span className="text-sm text-muted-foreground">
                      #{job.id.slice(0, 8)}
                    </span>
                  </div>
                  
                  <div className="text-sm text-muted-foreground">
                    Created {new Date(job.created_at).toLocaleString()}
                    {getProcessingDuration(job) && (
                      <> • Duration: {getProcessingDuration(job)}</>
                    )}
                  </div>
                  
                  {job.error_message && (
                    <div className="text-sm text-red-600 bg-red-50 p-2 rounded">
                      {job.error_message}
                    </div>
                  )}
                  
                  {job.metadata?.batch_size && (
                    <div className="text-sm text-blue-600">
                      Batch job ({job.metadata.batch_size} images)
                    </div>
                  )}
                </div>
                
                <div className="flex space-x-2">
                  {job.processed_image_url && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={job.processed_image_url} download target="_blank" rel="noopener noreferrer">
                        <Upload className="w-3 h-3 mr-1" />
                        Download
                      </a>
                    </Button>
                  )}
                  
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
                <Image className="w-12 h-12 mx-auto mb-4" />
                <p>No processing jobs yet</p>
                <p className="text-sm">Upload some images to get started!</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}