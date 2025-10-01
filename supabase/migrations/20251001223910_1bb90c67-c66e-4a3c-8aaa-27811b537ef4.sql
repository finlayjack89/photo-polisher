-- Add Cloudinary integration columns to batch_images table
ALTER TABLE public.batch_images 
ADD COLUMN cloudinary_public_id text,
ADD COLUMN cloudinary_version integer,
ADD COLUMN width integer,
ADD COLUMN height integer,
ADD COLUMN type text CHECK (type IN ('bag', 'backdrop', 'final', 'thumb')),
ADD COLUMN render_params jsonb;

-- Create index on cloudinary_public_id for faster lookups
CREATE INDEX idx_batch_images_cloudinary_public_id ON public.batch_images(cloudinary_public_id);

-- Create index on type for filtering
CREATE INDEX idx_batch_images_type ON public.batch_images(type);