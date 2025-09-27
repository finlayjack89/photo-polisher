-- Clean up legacy processing architecture
-- Drop the processing_jobs table as it's no longer needed with V5 single-image processing

DROP TABLE IF EXISTS public.processing_jobs;

-- Also clean up any related indexes that might exist
DROP INDEX IF EXISTS idx_processing_jobs_status;
DROP INDEX IF EXISTS idx_processing_jobs_user_id;
DROP INDEX IF EXISTS idx_processing_jobs_created_at;

-- Add a comment about the architectural change
COMMENT ON SCHEMA public IS 'Updated to V5 single-image processing architecture - removed complex job queue system';

-- The V5 architecture processes images individually in real-time,
-- eliminating the need for job queue management and complex state tracking