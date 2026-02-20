"""
Reprocess script to identify places without attractions and repopulate them.
For each place with no attractions:
  1. Check S3 for existing raw data
  2. If raw data exists, run ai_processor on it
  3. If no raw data, run main_scraper + ta_scraper + ai_processor
"""

import os
import subprocess
import sys
import json
from pathlib import Path
from typing import Optional

import boto3
from dotenv import load_dotenv
from supabase import create_client, Client

# Add parent path for imports
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def load_env():
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv(repo_root / ".env")
    load_dotenv(repo_root / ".env.local")


def get_clients() -> tuple[Client, any]:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    aws_region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
    if not supabase_url or not supabase_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    
    s3 = boto3.client(
        "s3",
        region_name=aws_region,
        aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
        aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
    )
    return create_client(supabase_url, supabase_key), s3


def has_attractions(supabase: Client, place_id: int) -> bool:
    """Check if place has any attractions."""
    res = supabase.table("attraction").select("attraction_id").eq(
        "place_id", place_id
    ).limit(1).execute()
    return bool(res.data)


def find_raw_data_for_place(s3_client: any, bucket: str, place_name: str) -> list[str]:
    """Find S3 files for this place in raw_scrapes/."""
    try:
        response = s3_client.list_objects_v2(
            Bucket=bucket,
            Prefix="raw_scrapes/"
        )
        
        if "Contents" not in response:
            return []
        
        place_slug = place_name.lower().replace(" ", "_").replace(",", "")
        matching_files = []
        
        for obj in response["Contents"]:
            key = obj["Key"]
            if key.endswith(".jsonl") and place_slug in key.lower():
                matching_files.append(key)
        
        return matching_files
    except Exception as e:
        print(f"    [WARNING] Error checking S3: {e}")
        return []


def get_python_exe() -> str:
    """Get the Python executable from the venv."""
    # Script is at: travel-app/ai_database/reprocess_places.py
    # Venv is at: travel-app/travelapp-py-env/Scripts/python.exe
    repo_root = Path(__file__).resolve().parent.parent  # travel-app folder
    venv_python = repo_root / "travelapp-py-env" / "Scripts" / "python.exe"
    
    if venv_python.exists():
        return str(venv_python)
    
    # Fallback to python
    return "python"


def get_clean_env() -> dict:
    """Get environment without debugger variables."""
    env = os.environ.copy()
    env.pop("PYTHONPATH", None)
    env.pop("PYTHONUNBUFFERED", None)
    # Remove all debugpy-related vars
    for key in list(env.keys()):
        if "DEBUG" in key or "debugpy" in key.lower() or "pydevd" in key.lower():
            env.pop(key, None)
    # Disable debugger explicitly and set UTF-8 encoding
    env["PYDEVD_DISABLE_FILE_VALIDATION"] = "1"
    env["PYTHONIOENCODING"] = "utf-8"
    return env


def run_ai_processor(place_name: str) -> bool:
    """Run ai_processor.py for a specific place."""
    try:
        ai_database_root = Path(__file__).resolve().parent  # ai_database folder
        ai_processor = ai_database_root / "ai_processor.py"
        python_exe = get_python_exe()
        
        env = get_clean_env()
        
        # Suppress output from subprocess to avoid encoding issues
        with open(os.devnull, 'w') as devnull:
            result = subprocess.run(
                [python_exe, "-Xfrozen_modules=off", str(ai_processor), "--place-name", place_name, "--force-refresh"],
                env=env,
                stdout=devnull,
                stderr=devnull,
                timeout=600
            )
        
        if result.returncode == 0:
            print(f"      [OK] AI Processor completed")
            return True
        else:
            print(f"      [FAIL] AI Processor failed with code {result.returncode}")
            return False
    except Exception as e:
        print(f"      [ERROR] {e}")
        return False


def run_main_scraper(place_name: str) -> bool:
    """Run main_scraper.py for a place."""
    try:
        scraper_path = Path(__file__).resolve().parents[2] / "web_scraper" / "code" / "1. main_scraper.py"
        python_exe = get_python_exe()
        
        if not scraper_path.exists():
            print(f"      [WARNING] Main scraper not found")
            return False
        
        # Suppress output to avoid encoding issues
        with open(os.devnull, 'w') as devnull:
            result = subprocess.run(
                [python_exe, "-Xfrozen_modules=off", str(scraper_path)],
                input=f"{place_name}\n",
                timeout=600,
                env=get_clean_env(),
                stdout=devnull,
                stderr=devnull
            )
        
        if result.returncode == 0:
            print(f"      [OK] Main scraper completed")
            return True
        else:
            print(f"      [FAIL] Main scraper failed")
            return False
    except Exception as e:
        print(f"      [ERROR] {e}")
        return False


def run_ta_scraper(place_name: str) -> bool:
    """Run ta_scraper.py for a place."""
    try:
        ta_scraper = Path(__file__).resolve().parents[2] / "data" / "TripAdvisor" / "ta_scraper.py"
        python_exe = get_python_exe()
        
        if not ta_scraper.exists():
            print(f"      [WARNING] TripAdvisor scraper not found")
            return False
        
        env = get_clean_env()
        env["TA_SEED_PLACE"] = place_name
        env["TA_SKIP_WEB_SCRAPER"] = "1"
        
        # Suppress output to avoid encoding issues
        with open(os.devnull, 'w') as devnull:
            result = subprocess.run(
                [python_exe, "-Xfrozen_modules=off", str(ta_scraper)],
                timeout=600,
                env=env,
                stdout=devnull,
                stderr=devnull
            )
        
        if result.returncode == 0:
            print(f"      [OK] TripAdvisor scraper completed")
            return True
        else:
            print(f"      [FAIL] TripAdvisor scraper failed")
            return False
    except Exception as e:
        print(f"      ⚠️  Error: {e}")
        return False


def reprocess_places(supabase: Client, s3_client: any, bucket: str):
    """Main reprocessing logic."""
    
    print("[PLACES] Fetching all places...")
    
    # Get all places
    offset = 0
    batch_size = 100
    total_places = 0
    places_with_attractions = 0
    places_reprocessed = 0
    
    while True:
        places_res = supabase.table("place").select(
            "place_id,place_city"
        ).range(offset, offset + batch_size - 1).execute()
        
        places = places_res.data or []
        if not places:
            break
        
        for place in places:
            place_id = place.get("place_id")
            place_name = place.get("place_city") or "unknown"
            total_places += 1
            
            # Check if attractions exist
            if has_attractions(supabase, place_id):
                places_with_attractions += 1
                continue
            
            print(f"\n[WARNING] Place has no attractions: {place_name} (ID: {place_id})")
            
            # Check for raw data
            raw_files = find_raw_data_for_place(s3_client, bucket, place_name)
            
            if raw_files:
                print(f"   Found {len(raw_files)} raw data file(s) in S3")
                print(f"   Running AI Processor...")
                if run_ai_processor(place_name):
                    places_reprocessed += 1
            else:
                print(f"   No raw data in S3")
                print(f"   Running full pipeline...")
                
                # Run main scraper
                if not run_main_scraper(place_name):
                    print(f"      [FAIL] Skipping due to main scraper failure")
                    continue
                
                # Run ta_scraper
                if not run_ta_scraper(place_name):
                    print(f"      [FAIL] Skipping due to ta_scraper failure")
                    continue
                
                # Run ai_processor
                if run_ai_processor(place_name):
                    places_reprocessed += 1
                else:
                    print(f"      [FAIL] AI Processor failed")
        
        offset += batch_size
    
    print(f"\n[SUCCESS] Reprocessing complete!")
    print(f"   Total places: {total_places}")
    print(f"   Places with attractions: {places_with_attractions}")
    print(f"   Places reprocessed: {places_reprocessed}")



def main():
    load_env()
    
    bucket = os.getenv("S3_BUCKET_NAME")
    if not bucket:
        raise RuntimeError("Missing S3_BUCKET_NAME in .env")
    
    supabase, s3 = get_clients()
    reprocess_places(supabase, s3, bucket)


if __name__ == "__main__":
    main()
