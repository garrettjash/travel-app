-- Ensure collab_session has collab_place_id (required for collab session creation).
-- Run in Supabase Dashboard SQL Editor: https://supabase.com/dashboard/project/_/sql
ALTER TABLE collab_session
ADD COLUMN IF NOT EXISTS collab_place_id bigint;
