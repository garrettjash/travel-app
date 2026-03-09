-- Add itinerary_id to collab_session for linking to itinerary when session expires.
-- Run this in Supabase Dashboard (SQL Editor) or via supabase db push.
-- Required for collab session → itinerary flow when link expires (Option A).
ALTER TABLE collab_session
ADD COLUMN IF NOT EXISTS itinerary_id uuid;
