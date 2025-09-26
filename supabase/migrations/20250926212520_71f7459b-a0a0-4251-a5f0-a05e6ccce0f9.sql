-- Fix function search path security warnings

-- Fix update_user_quota_usage function
CREATE OR REPLACE FUNCTION public.update_user_quota_usage(user_id UUID, increment INTEGER DEFAULT 1)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Fix reset_monthly_quotas function
CREATE OR REPLACE FUNCTION public.reset_monthly_quotas()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Fix cleanup_expired_data function
CREATE OR REPLACE FUNCTION public.cleanup_expired_data()
RETURNS TABLE(jobs_deleted INTEGER, cache_deleted INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Fix get_cache_entry function
CREATE OR REPLACE FUNCTION public.get_cache_entry(
  p_original_url TEXT,
  p_operation operation_type,
  p_options_hash TEXT
)
RETURNS TABLE(processed_url TEXT, hit_count INTEGER)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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

-- Fix update_updated_at_column function
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER 
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;