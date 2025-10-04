-- Create storage bucket for user backdrops
INSERT INTO storage.buckets (id, name, public)
VALUES ('user-backdrops', 'user-backdrops', true)
ON CONFLICT (id) DO NOTHING;