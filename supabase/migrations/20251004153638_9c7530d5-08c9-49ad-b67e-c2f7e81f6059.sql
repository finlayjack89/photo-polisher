-- Create batch_images table to store individual images within batches
CREATE TABLE IF NOT EXISTS public.batch_images (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.project_batches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  image_type TEXT NOT NULL CHECK (image_type IN ('transparent', 'ai_enhanced', 'final')),
  storage_path TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  dimensions JSONB NOT NULL DEFAULT '{"width": 0, "height": 0}'::jsonb,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_batch_images_batch_id ON public.batch_images(batch_id);
CREATE INDEX IF NOT EXISTS idx_batch_images_type ON public.batch_images(image_type);

-- Enable RLS
ALTER TABLE public.batch_images ENABLE ROW LEVEL SECURITY;

-- RLS Policies for batch_images
CREATE POLICY "Users can view their own batch images"
  ON public.batch_images
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.project_batches
      WHERE project_batches.id = batch_images.batch_id
      AND project_batches.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert their own batch images"
  ON public.batch_images
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.project_batches
      WHERE project_batches.id = batch_images.batch_id
      AND project_batches.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can delete their own batch images"
  ON public.batch_images
  FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM public.project_batches
      WHERE project_batches.id = batch_images.batch_id
      AND project_batches.user_id = auth.uid()
    )
  );