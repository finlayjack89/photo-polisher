-- Create backdrop library table
CREATE TABLE public.backdrop_library (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  file_size INTEGER,
  dimensions JSONB, -- {width: number, height: number}
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.backdrop_library ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY "Users can view their own backdrops" 
ON public.backdrop_library 
FOR SELECT 
USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own backdrops" 
ON public.backdrop_library 
FOR INSERT 
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own backdrops" 
ON public.backdrop_library 
FOR UPDATE 
USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own backdrops" 
ON public.backdrop_library 
FOR DELETE 
USING (auth.uid() = user_id);

-- Add trigger for updated_at
CREATE TRIGGER update_backdrop_library_updated_at
BEFORE UPDATE ON public.backdrop_library
FOR EACH ROW
EXECUTE FUNCTION public.update_updated_at_column();

-- Create storage bucket for backdrops (if not exists)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('user-backdrops', 'user-backdrops', false, 52428800, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;

-- Storage policies for user backdrops
CREATE POLICY "Users can view their own backdrops" 
ON storage.objects 
FOR SELECT 
USING (bucket_id = 'user-backdrops' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can upload their own backdrops" 
ON storage.objects 
FOR INSERT 
WITH CHECK (bucket_id = 'user-backdrops' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can update their own backdrops" 
ON storage.objects 
FOR UPDATE 
USING (bucket_id = 'user-backdrops' AND auth.uid()::text = (storage.foldername(name))[1]);

CREATE POLICY "Users can delete their own backdrops" 
ON storage.objects 
FOR DELETE 
USING (bucket_id = 'user-backdrops' AND auth.uid()::text = (storage.foldername(name))[1]);