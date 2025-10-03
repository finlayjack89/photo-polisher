-- First, delete all objects from buckets we want to remove
DELETE FROM storage.objects WHERE bucket_id IN ('user-backdrops', 'thumbnails', 'project-images');

-- Now drop the buckets
DELETE FROM storage.buckets WHERE id IN ('user-backdrops', 'thumbnails', 'project-images');

-- Drop all existing processing-related tables
DROP TABLE IF EXISTS public.processing_cache CASCADE;
DROP TABLE IF EXISTS public.processing_jobs CASCADE;
DROP TABLE IF EXISTS public.batch_images CASCADE;
DROP TABLE IF EXISTS public.user_quotas CASCADE;

-- Create simplified tables for new workflow
CREATE TABLE public.projects (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.project_images (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  original_url TEXT NOT NULL,
  no_bg_url TEXT,
  cloudinary_public_id TEXT,
  status TEXT DEFAULT 'uploaded' NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

CREATE TABLE public.final_renders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID REFERENCES public.projects(id) ON DELETE CASCADE,
  image_id UUID REFERENCES public.project_images(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  backdrop_url TEXT NOT NULL,
  subject_position JSONB NOT NULL,
  final_url TEXT NOT NULL,
  cloudinary_render_id TEXT,
  created_at TIMESTAMPTZ DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_images ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.final_renders ENABLE ROW LEVEL SECURITY;

-- RLS Policies for projects
CREATE POLICY "Users can view their own projects"
  ON public.projects FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own projects"
  ON public.projects FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own projects"
  ON public.projects FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete their own projects"
  ON public.projects FOR DELETE
  USING (auth.uid() = user_id);

-- RLS Policies for project_images
CREATE POLICY "Users can view their own images"
  ON public.project_images FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own images"
  ON public.project_images FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update their own images"
  ON public.project_images FOR UPDATE
  USING (auth.uid() = user_id);

-- RLS Policies for final_renders
CREATE POLICY "Users can view their own renders"
  ON public.final_renders FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create their own renders"
  ON public.final_renders FOR INSERT
  WITH CHECK (auth.uid() = user_id);

-- Trigger for updated_at
CREATE TRIGGER update_projects_updated_at
  BEFORE UPDATE ON public.projects
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();