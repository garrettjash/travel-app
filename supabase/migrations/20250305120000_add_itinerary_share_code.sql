-- Add share code fields to itinerary for gated editing.
-- Run this in Supabase (SQL editor or via supabase db push).

ALTER TABLE itinerary
ADD COLUMN IF NOT EXISTS share_code text,
ADD COLUMN IF NOT EXISTS share_code_required boolean NOT NULL DEFAULT false;

