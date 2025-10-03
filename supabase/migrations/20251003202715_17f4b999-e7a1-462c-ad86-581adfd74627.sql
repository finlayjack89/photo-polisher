-- Add cloudinary_public_id column to backdrop_library table
ALTER TABLE backdrop_library 
ADD COLUMN cloudinary_public_id TEXT;