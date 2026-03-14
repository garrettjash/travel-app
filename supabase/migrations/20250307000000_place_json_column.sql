-- Replace place_id with place JSON: [{ placeId, placeName }, ...]
-- First element = primary; rest = extra places. Handles both single and multi-place itineraries.

-- Add new place column
ALTER TABLE itinerary
ADD COLUMN IF NOT EXISTS place jsonb;

-- Migrate from place_id (backfill place with id and name from place table)
UPDATE itinerary i
SET place = jsonb_build_array(
  jsonb_build_object(
    'placeId', i.place_id,
    'placeName', COALESCE(NULLIF(TRIM(CONCAT_WS(', ', p.place_city, p.place_countryregion)), ''), '')
  )
)
FROM place p
WHERE i.place_id = p.place_id
  AND (i.place IS NULL OR i.place = 'null'::jsonb);

-- Rows with place_id not found in place table
UPDATE itinerary
SET place = jsonb_build_array(jsonb_build_object('placeId', place_id, 'placeName', ''))
WHERE place_id IS NOT NULL
  AND (place IS NULL OR place = 'null'::jsonb);

-- Rows with null place_id
UPDATE itinerary SET place = '[]'::jsonb WHERE place IS NULL;

-- Merge extra_places into place if column exists
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'itinerary' AND column_name = 'extra_places'
  ) THEN
    UPDATE itinerary
    SET place = COALESCE(place, '[]'::jsonb) || (
      SELECT COALESCE(
        jsonb_agg(
          jsonb_build_object(
            'placeId', (elem->>'placeId')::int,
            'placeName', COALESCE(NULLIF(TRIM(elem->>'label'), ''), elem->>'placeName', '')
          )
        ),
        '[]'::jsonb
      )
      FROM jsonb_array_elements(
        CASE WHEN extra_places IS NULL OR extra_places = 'null'::jsonb
          THEN '[]'::jsonb ELSE extra_places END
      ) AS elem
    )
    WHERE extra_places IS NOT NULL AND extra_places != '[]'::jsonb AND extra_places != 'null'::jsonb;
    ALTER TABLE itinerary DROP COLUMN IF EXISTS extra_places;
  END IF;
END $$;

-- Drop place_id
ALTER TABLE itinerary DROP COLUMN IF EXISTS place_id;

-- Default for new rows
ALTER TABLE itinerary ALTER COLUMN place SET DEFAULT '[]'::jsonb;
