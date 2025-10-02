-- Add floor_y_px column to backdrop_library table
-- This stores the Y coordinate (in pixels) where the floor/ground plane is located in each backdrop
ALTER TABLE backdrop_library 
ADD COLUMN floor_y_px INTEGER DEFAULT NULL;

-- Add helpful comment
COMMENT ON COLUMN backdrop_library.floor_y_px IS 'Y coordinate in pixels where reflections and shadows should be anchored (floor baseline)';