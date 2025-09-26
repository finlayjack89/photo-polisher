-- Create storage buckets for image processing
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('original-images', 'original-images', false),
  ('processed-images', 'processed-images', true),
  ('thumbnails', 'thumbnails', true);

-- Create enum for processing status
CREATE TYPE public.processing_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');

-- Create enum for operation types
CREATE TYPE public.operation_type AS ENUM ('upscale', 'compress', 'thumbnail', 'format_convert', 'batch');

-- Create processing_jobs table
CREATE TABLE public.processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  operation operation_type NOT NULL,
  status processing_status DEFAULT 'pending',
  original_image_url TEXT NOT NULL,
  processed_image_url TEXT,
  thumbnail_url TEXT,
  metadata JSONB DEFAULT '{}',
  error_message TEXT,
  processing_options JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '30 days')
);

-- Create user_quotas table
CREATE TABLE public.user_quotas (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  monthly_limit INTEGER DEFAULT 100,
  current_usage INTEGER DEFAULT 0,
  reset_date TIMESTAMP WITH TIME ZONE DEFAULT (date_trunc('month', now()) + INTERVAL '1 month'),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create processing_cache table
CREATE TABLE public.processing_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cache_key TEXT UNIQUE NOT NULL,
  original_url TEXT NOT NULL,
  processed_url TEXT NOT NULL,
  operation operation_type NOT NULL,
  options_hash TEXT NOT NULL,
  hit_count INTEGER DEFAULT 1,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  last_accessed TIMESTAMP WITH TIME ZONE DEFAULT now(),
  expires_at TIMESTAMP WITH TIME ZONE DEFAULT (now() + INTERVAL '7 days')
);

-- Create system_health table for monitoring
CREATE TABLE public.system_health (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  metric_name TEXT NOT NULL,
  metric_value NUMERIC NOT NULL,
  metadata JSONB DEFAULT '{}',
  recorded_at TIMESTAMP WITH TIME ZONE DEFAULT now()
);

-- Create indexes for performance
CREATE INDEX idx_processing_jobs_user_id ON public.processing_jobs(user_id);
CREATE INDEX idx_processing_jobs_status ON public.processing_jobs(status);
CREATE INDEX idx_processing_jobs_created_at ON public.processing_jobs(created_at);
CREATE INDEX idx_processing_jobs_expires_at ON public.processing_jobs(expires_at);
CREATE INDEX idx_processing_cache_cache_key ON public.processing_cache(cache_key);
CREATE INDEX idx_processing_cache_expires_at ON public.processing_cache(expires_at);
CREATE INDEX idx_user_quotas_user_id ON public.user_quotas(user_id);
CREATE INDEX idx_system_health_metric_name ON public.system_health(metric_name);
CREATE INDEX idx_system_health_recorded_at ON public.system_health(recorded_at);

-- Enable RLS on all tables
ALTER TABLE public.processing_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_quotas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_cache ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;

-- RLS policies for processing_jobs
CREATE POLICY "Users can view their own processing jobs" ON public.processing_jobs
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own processing jobs" ON public.processing_jobs
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own processing jobs" ON public.processing_jobs
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS policies for user_quotas
CREATE POLICY "Users can view their own quotas" ON public.user_quotas
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update their own quotas" ON public.user_quotas
  FOR UPDATE USING (auth.uid() = user_id);

-- RLS policies for processing_cache (public read for performance)
CREATE POLICY "Cache is publicly readable" ON public.processing_cache
  FOR SELECT USING (true);

-- RLS policies for system_health (admin only)
CREATE POLICY "System health is admin only" ON public.system_health
  FOR ALL USING (false); -- Will be updated when admin roles are implemented

-- Storage policies for original-images bucket
CREATE POLICY "Users can upload their own images" ON storage.objects
  FOR INSERT WITH CHECK (
    bucket_id = 'original-images' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can view their own images" ON storage.objects
  FOR SELECT USING (
    bucket_id = 'original-images' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

CREATE POLICY "Users can delete their own images" ON storage.objects
  FOR DELETE USING (
    bucket_id = 'original-images' AND 
    auth.uid()::text = (storage.foldername(name))[1]
  );

-- Storage policies for processed-images bucket (public read)
CREATE POLICY "Processed images are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'processed-images');

CREATE POLICY "Service can manage processed images" ON storage.objects
  FOR ALL USING (bucket_id = 'processed-images');

-- Storage policies for thumbnails bucket (public read)
CREATE POLICY "Thumbnails are publicly readable" ON storage.objects
  FOR SELECT USING (bucket_id = 'thumbnails');

CREATE POLICY "Service can manage thumbnails" ON storage.objects
  FOR ALL USING (bucket_id = 'thumbnails');

-- Function to update user quota usage
CREATE OR REPLACE FUNCTION public.update_user_quota_usage(user_id UUID, increment INTEGER DEFAULT 1)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_quota RECORD;
BEGIN
  -- Get or create user quota
  INSERT INTO public.user_quotas (user_id, current_usage)
  VALUES (user_id, increment)
  ON CONFLICT (user_id) 
  DO UPDATE SET 
    current_usage = user_quotas.current_usage + increment,
    updated_at = now()
  RETURNING * INTO current_quota;
  
  -- Check if over limit
  RETURN current_quota.current_usage <= current_quota.monthly_limit;
END;
$$;

-- Function to reset monthly quotas
CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  reset_count INTEGER;
BEGIN
  UPDATE public.user_quotas 
  SET 
    current_usage = 0,
    reset_date = date_trunc('month', now()) + INTERVAL '1 month',
    updated_at = now()
  WHERE reset_date <= now();
  
  GET DIAGNOSTICS reset_count = ROW_COUNT;
  RETURN reset_count;
END;
$$;

-- Function to cleanup expired jobs and cache
CREATE OR REPLACE FUNCTION public.cleanup_expired_data()
RETURNS TABLE(jobs_deleted INTEGER, cache_deleted INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  jobs_count INTEGER;
  cache_count INTEGER;
BEGIN
  -- Delete expired processing jobs
  DELETE FROM public.processing_jobs WHERE expires_at < now();
  GET DIAGNOSTICS jobs_count = ROW_COUNT;
  
  -- Delete expired cache entries
  DELETE FROM public.processing_cache WHERE expires_at < now();
  GET DIAGNOSTICS cache_count = ROW_COUNT;
  
  RETURN QUERY SELECT jobs_count, cache_count;
END;
$$;

-- Function to get cache entry
CREATE OR REPLACE FUNCTION public.get_cache_entry(
  p_original_url TEXT,
  p_operation operation_type,
  p_options_hash TEXT
)
RETURNS TABLE(processed_url TEXT, hit_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cache_key_val TEXT;
BEGIN
  cache_key_val := MD5(p_original_url || p_operation || p_options_hash);
  
  -- Update hit count and last accessed time
  UPDATE public.processing_cache 
  SET 
    hit_count = hit_count + 1,
    last_accessed = now()
  WHERE cache_key = cache_key_val AND expires_at > now();
  
  -- Return the cached result
  RETURN QUERY 
  SELECT pc.processed_url, pc.hit_count
  FROM public.processing_cache pc
  WHERE pc.cache_key = cache_key_val AND pc.expires_at > now();
END;
$$;

-- Trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_user_quotas_updated_at
  BEFORE UPDATE ON public.user_quotas
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();