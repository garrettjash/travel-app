## GENERAL
This processor takes raw data from S3 that was scraped, and it will organize that data to fit into the database
Use ai_processor.py

## clean_data.py
One-time cleanup script for the `attraction` table.
- Finds likely duplicate attractions and merges them into one keeper record.
- Removes non-tourist/service entries like airport lounges, taxi services, and car rentals.
- Supports preview mode by default; pass `--apply` to actually write changes.

## backfill_sources_embeddings.py
Only is a one-time script to populate the Supabase attraction_embeddings column with embeddings for attraction_sources_rawtext fields to provide more context to the chatbot

## backfill_images.py
A one-time script to populate the database and S3 with images for attractions, but stored on the Place level in S3 and by attraction_id in Supabase images table