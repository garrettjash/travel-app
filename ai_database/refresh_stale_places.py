"""
Refresh places whose attractions haven't been updated in over 3 months.

For each stale place (e.g. Los Angeles), runs the full pipeline:
  1. Main scraper (web articles)
  2. TripAdvisor scraper
  3. AI processor (processes new data, updates attraction_lastrefreshed)

Run nightly to keep place data fresh. Example: if LA's last refresh was >90 days ago,
this will scrape fresh data for LA and update all LA attractions.
"""

import os
import subprocess
import sys
from datetime import datetime, timezone, timedelta
from pathlib import Path

import boto3
from dotenv import load_dotenv
from supabase import create_client, Client


def load_env():
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv(repo_root / ".env")
    load_dotenv(repo_root / ".env.local")


def get_supabase() -> Client:
    url = os.getenv("SUPABASE_URL")
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


def build_place_display_name(place: dict) -> str:
    """Build 'City, Country' for scraper input (e.g. 'Los Angeles, USA')."""
    city = (place.get("place_city") or "").strip()
    country = (place.get("place_countryregion") or "").strip()
    if not city:
        return "Unknown"
    if country:
        return f"{city}, {country}"
    return city


def find_stale_places(supabase: Client, stale_days: int = 90) -> list[dict]:
    """
    Find places where the most recent attraction_lastrefreshed is older than stale_days.
    Only includes places that have at least one attraction.
    """
    cutoff = (datetime.now(timezone.utc) - timedelta(days=stale_days)).isoformat()

    # Get max attraction_lastrefreshed per place_id
    res = supabase.table("attraction").select(
        "place_id, attraction_lastrefreshed"
    ).execute()

    # Group by place_id, keep max date per place
    place_max_refresh = {}
    for row in res.data or []:
        pid = row.get("place_id")
        refreshed = row.get("attraction_lastrefreshed")
        if pid is None:
            continue
        if pid not in place_max_refresh:
            place_max_refresh[pid] = refreshed
        elif refreshed and (place_max_refresh[pid] is None or refreshed > place_max_refresh[pid]):
            place_max_refresh[pid] = refreshed

    # Filter to stale: max is None or < cutoff
    stale_place_ids = [
        pid for pid, max_date in place_max_refresh.items()
        if max_date is None or max_date < cutoff
    ]

    if not stale_place_ids:
        return []

    # Fetch place details for stale place_ids
    places_res = supabase.table("place").select(
        "place_id, place_city, place_countryregion, place_stateprovince"
    ).in_("place_id", stale_place_ids).execute()

    return places_res.data or []


def run_main_scraper(place_name: str, timeout: int = 1800) -> bool:
    """Run main_scraper.py for a place."""
    repo_root = Path(__file__).resolve().parent.parent
    scraper_path = repo_root / "web_scraper" / "code" / "1. main_scraper.py"
    if not scraper_path.exists():
        print(f"      [WARN] main_scraper not found at {scraper_path}")
        return False

    env = os.environ.copy()
    env["MAIN_SCRAPER_DESTINATION"] = place_name
    env["MAIN_SCRAPER_WEB_ONLY"] = "1"
    env["MAIN_SCRAPER_FORCE_REFRESH"] = "1"

    try:
        result = subprocess.run(
            [sys.executable, str(scraper_path)],
            input=f"{place_name}\n",
            text=True,
            env=env,
            timeout=timeout,
            capture_output=False,
        )
        if result.returncode == 0:
            print(f"      [OK] Main scraper completed for {place_name}")
            return True
        print(f"      [FAIL] Main scraper exit code {result.returncode}")
        return False
    except subprocess.TimeoutExpired:
        print(f"      [FAIL] Main scraper timeout")
        return False
    except Exception as e:
        print(f"      [ERROR] {e}")
        return False


def run_ta_scraper(place_name: str, timeout: int = 600) -> bool:
    """Run ta_scraper.py for a place."""
    repo_root = Path(__file__).resolve().parent.parent
    ta_path = repo_root / "data" / "TripAdvisor" / "ta_scraper.py"
    if not ta_path.exists():
        print(f"      [WARN] ta_scraper not found at {ta_path}")
        return False

    env = os.environ.copy()
    env["TA_SEED_PLACE"] = place_name
    env["TA_WEB_SCRAPER_LIMIT"] = "0"
    env["TA_NON_INTERACTIVE"] = "1"

    try:
        result = subprocess.run(
            [sys.executable, str(ta_path)],
            env=env,
            timeout=timeout,
            capture_output=False,
        )
        if result.returncode == 0:
            print(f"      [OK] TripAdvisor scraper completed for {place_name}")
            return True
        print(f"      [FAIL] TripAdvisor scraper exit code {result.returncode}")
        return False
    except subprocess.TimeoutExpired:
        print(f"      [FAIL] TripAdvisor scraper timeout")
        return False
    except Exception as e:
        print(f"      [ERROR] {e}")
        return False


def run_ai_processor(place_name: str, s3_key: str | None = None, timeout: int = 900) -> bool:
    """Run ai_processor.py for a place or specific S3 file."""
    repo_root = Path(__file__).resolve().parent.parent
    ai_path = repo_root / "ai_database" / "ai_processor.py"
    if not ai_path.exists():
        print(f"      [WARN] ai_processor not found at {ai_path}")
        return False

    cmd = [sys.executable, str(ai_path), "--force-refresh"]
    if s3_key:
        cmd.extend(["--s3-key", s3_key])
    else:
        cmd.extend(["--place-name", place_name])

    try:
        result = subprocess.run(cmd, timeout=timeout, capture_output=False)
        if result.returncode == 0:
            print(f"      [OK] AI processor completed for {place_name or s3_key}")
            return True
        print(f"      [FAIL] AI processor exit code {result.returncode}")
        return False
    except subprocess.TimeoutExpired:
        print(f"      [FAIL] AI processor timeout")
        return False
    except Exception as e:
        print(f"      [ERROR] {e}")
        return False


def get_newest_ta_s3_key() -> str | None:
    """Find the most recently uploaded ta_attractions_*.jsonl in S3."""
    bucket = os.getenv("S3_BUCKET_NAME")
    if not bucket:
        return None
    try:
        s3 = boto3.client(
            "s3",
            aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
            aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
        )
        paginator = s3.get_paginator("list_objects_v2")
        files = []
        for page in paginator.paginate(Bucket=bucket, Prefix="raw_scrapes/ta_attractions_"):
            for obj in page.get("Contents", []):
                if obj["Key"].endswith(".jsonl"):
                    files.append(obj)
        if not files:
            return None
        newest = max(files, key=lambda x: x["LastModified"])
        return newest["Key"]
    except Exception as e:
        print(f"      [WARN] Could not list S3 for TA file: {e}")
        return None


def refresh_place(place: dict, limit_per_run: int | None = None) -> bool:
    """
    Full pipeline for one place: main scraper -> TA scraper -> AI processor.
    Uses place_city for --place-name matching (e.g. 'Los Angeles' matches los_angeles in keys).
    Also processes newest ta_attractions_*.jsonl from TA scraper output.
    Returns True if AI processing succeeded (scrapers may fail but we still process what we have).
    """
    place_name = build_place_display_name(place)
    city = (place.get("place_city") or place_name).strip()
    print(f"\n🔄 Refreshing: {place_name} (place_id={place.get('place_id')})")

    run_main_scraper(place_name)
    run_ta_scraper(place_name)

    # Process main scraper output (files with city name in key, e.g. los_angeles,_usa_xxx.jsonl)
    ai_ok = run_ai_processor(city)
    # Process TA output (ta_attractions_xxx.jsonl - key doesn't include place name)
    ta_key = get_newest_ta_s3_key()
    ta_ok = False
    if ta_key:
        print(f"      Processing TA file: {ta_key}")
        ta_ok = run_ai_processor(place_name, s3_key=ta_key)

    if not ai_ok and not ta_ok:
        print(f"   [FAIL] AI processor failed for both main and TA outputs")
        return False

    print(f"   ✅ Successfully refreshed {place_name}")
    return True


def main():
    load_env()

    stale_days = int(os.getenv("REFRESH_STALE_DAYS", "90"))
    limit = os.getenv("REFRESH_STALE_LIMIT")
    limit_per_run = int(limit) if limit else None

    supabase = get_supabase()
    stale_places = find_stale_places(supabase, stale_days=stale_days)

    if not stale_places:
        print("✅ No stale places found (all data is within 3 months)")
        return

    if limit_per_run and limit_per_run > 0:
        stale_places = stale_places[:limit_per_run]
        print(f"📋 Limiting to {limit_per_run} place(s) this run")

    print(f"\n📍 Found {len(stale_places)} stale place(s) (last refresh > {stale_days} days ago)")
    for p in stale_places:
        print(f"   - {build_place_display_name(p)} (place_id={p.get('place_id')})")

    successes = 0
    failures = 0
    for place in stale_places:
        if refresh_place(place):
            successes += 1
        else:
            failures += 1

    print(f"\n✅ Refresh complete: {successes} succeeded, {failures} failed")
    if failures > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
