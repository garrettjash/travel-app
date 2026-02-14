# AI Processor - Data Refresh Guide

## Overview
The `ai_processor.py` now supports automatic data refresh for stale entries (older than 3 months). When stale data is detected, it automatically triggers `main_scraper.py` to fetch fresh content before processing.

## How It Works

### Refresh Flow
1. **Detect Stale Data**: Checks if a location's data is >90 days old
2. **Extract Location**: Gets location name from filename (e.g., "budapest" from `budapest_20231113.jsonl`)
3. **Trigger Scraper**: Calls `main_scraper.py` to scrape fresh web articles for that location
4. **Process New Data**: Once scraping completes, AI processes the newly scraped content
5. **Update Database**: New data replaces old entries in Supabase

### Database Updates
- Attractions are upserted (updated if they exist, inserted if new)
- Old source links and ratings are replaced with fresh data
- The `processed_at` timestamp is updated to reset the 3-month clock

## Command Line Options

### Normal Mode (Default)
```bash
python ai_database/ai_processor.py
```
- Processes new files
- Automatically scrapes and refreshes data older than 3 months
- Skips recently processed files

### Force Refresh All Data
```bash
python ai_database/ai_processor.py --force-refresh
```
- Triggers fresh scraping for ALL locations
- Reprocesses ALL files regardless of when they were last processed
- Useful for schema changes or major updates
- **Warning**: This will scrape all locations, which may take hours

### Refresh Only Stale Data
```bash
python ai_database/ai_processor.py --refresh-stale
```
- Explicitly refresh data older than 3 months
- Same as default behavior but more explicit
- Triggers scraping for stale locations only

### Skip Staleness Check
```bash
python ai_database/ai_processor.py --no-staleness-check
```
- Only process new or failed files
- Skip the 3-month staleness check
- No scraping triggered

### Reprocess Without Scraping
```bash
python ai_database/ai_processor.py --no-scraper
```
- Check for stale data but don't trigger fresh scraping
- Only reprocess existing old files (re-run AI analysis on old content)
- Useful for testing or when you just want to update AI processing logic

### Process Specific File
```bash
python ai_database/ai_processor.py --s3-key "raw_scrapes/budapest_data.jsonl"
```
- Process a specific S3 file
- Will trigger scraping if file is stale (unless --no-scraper is used)
- Useful for testing or targeted updates

## GitHub Actions

A GitHub Actions workflow has been created at `.github/workflows/refresh-data.yml`:

### Automatic Monthly Refresh
- Runs on the 1st of each month at 2 AM UTC
- Automatically identifies locations with data >3 months old
- Triggers web scraping for those locations
- Processes and updates database with fresh content

### Manual Trigger
You can manually trigger the workflow from GitHub:
1. Go to Actions tab in your repository
2. Select "Refresh Travel Data" workflow
3. Click "Run workflow"
4. Optionally check "Force refresh all data" (warning: will scrape all locations)

**Note**: Full refresh can take several hours depending on the number of locations.

## How It Works

### Staleness Check
The processor checks the `processed_scraped_data` table in Supabase:
- Compares `processed_at` timestamp with current time
- If difference > 90 days, the location needs fresh data
- Extracts location name from S3 filename
- Triggers `main_scraper.py` with that location
- Waits for scraping to complete and finds the new file
- Processes the newly scraped content
- Updates `processed_at` timestamp after successful processing

### Location Name Extraction
The location is extracted from the S3 filename:
- `raw_scrapes/budapest_20231113.jsonl` → "budapest"
- `raw_scrapes/paris_2024_01_15.jsonl` → "paris"
- This location is passed to `main_scraper.py` for fresh scraping

### Database Updates
When processing refreshed data:
- **Attractions**: Upserted by `(attraction_name, place_id)`
  - Existing attractions are updated with new information
  - New attractions are inserted
- **Sources**: Linked to attractions with latest scraped content
- **Ratings & Reviews**: Updated with current data from web sources
- **Embeddings**: Regenerated for updated content

### Database Schema
The `processed_scraped_data` table tracks:
- `s3_key`: The S3 file path
- `processed_at`: ISO timestamp of last processing
- `status`: 'success' or 'failed'

## Required Secrets

Make sure these secrets are configured in GitHub:
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `AWS_REGION`
- `OPENAI_API_KEY`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `S3_BUCKET_NAME`

## Troubleshooting

### Scraping Times Out
If a location takes too long to scrape (>30 minutes):
- The processor will fall back to reprocessing the old file
- You can manually run the scraper separately:
  ```bash
  python web_scraper/code/1.\ main_scraper.py
  # Enter the location
  ```
- Then process the new file:
  ```bash
  python ai_database/ai_processor.py
  ```

### Want to Reprocess Without Scraping
Use the `--no-scraper` flag:
```bash
python ai_database/ai_processor.py --no-scraper
```
This is useful when you've updated the AI processing logic but don't need fresh web content.

## Integration with main_scraper.py

When `main_scraper.py` adds new data or when refresh is triggered:
1. `main_scraper.py` scrapes web articles for a location
2. Uploads new `.jsonl` file to S3 with timestamp
3. `ai_processor.py` detects and processes the new file
4. For stale data (>3 months), processor automatically triggers scraping

### Manual Workflow
```bash
# Add a new location manually
python web_scraper/code/1.\ main_scraper.py
# (Enter location when prompted)

# Process all new and stale data
python ai_database/ai_processor.py
```

### Automated Workflow
Just run:
```bash
python ai_database/ai_processor.py
```
This handles everything:
- Detects stale locations
- Triggers scraping automatically
- Processes fresh content
- Updates database

## Example Scenarios

### Scenario 1: New Location
```bash
# Add Budapest
python web_scraper/code/1.\ main_scraper.py
# Enter: budapest

# It auto-runs ai_processor, but you can also run manually:
python ai_database/ai_processor.py
```

### Scenario 2: Refresh Stale Data
```bash
# Automatically finds and refreshes locations >3 months old
python ai_database/ai_processor.py
```
Output:
```
⏰ Data is 95 days old (>90 days). Needs refresh...
🔄 Data is stale for Prague. Fetching fresh data...
🧭 Running TripAdvisor scraper for: Prague
🔎 Searching Google for: Prague travel guide
✅ Scraping completed for Prague
🔍 Looking for newly scraped file for Prague...
✅ Found new file: raw_scrapes/prague_20260213_143022.jsonl
▶️  STARTING: raw_scrapes/prague_20260213_143022.jsonl
```

### Scenario 3: Refresh Specific Location
```bash
# Force refresh Budapest specifically
python ai_database/ai_processor.py --s3-key "raw_scrapes/budapest_20231113.jsonl" --force-refresh
```
