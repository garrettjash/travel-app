import json
import os
import boto3
import tempfile
import datetime
import re
import time
import concurrent.futures
import threading
import argparse
import subprocess
import sys
from urllib.parse import urlparse
from typing import List, Optional, Literal, Any, Dict
from datetime import timedelta
from pydantic import BaseModel, Field, ConfigDict
from openai import OpenAI
from supabase import create_client, Client
from dotenv import load_dotenv
from pathlib import Path
from geopy.geocoders import Nominatim
from geopy.distance import geodesic

# Load .env.local/.env from repo root (works from any cwd)
repo_root = Path(__file__).resolve().parents[1]
load_dotenv(repo_root / ".env")

# --- GLOBAL LOCKS ---
CACHE_LOCK = threading.Lock() # Prevents cache file corruption
PRINT_LOCK = threading.Lock() # Prevents messy console output
GEO_API_LOCK = threading.Lock() # STRICTLY forces Geocoding to be sequential

# --- CONFIGURATION ---
# From the .ENV file
S3_BUCKET = os.getenv("S3_BUCKET_NAME")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")
SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_KEY = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
AWS_REGION = os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"

# --- CLIENTS ---
s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY")
)
openai_client = OpenAI(api_key=OPENAI_API_KEY)
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
geolocator = Nominatim(user_agent="travel_app_etl_v6_stable")

# --- CACHING SYSTEM ---
CACHE_FILE = "geo_cache.json"
GEO_CACHE = {}

def load_cache():
    global GEO_CACHE
    if os.path.exists(CACHE_FILE):
        with open(CACHE_FILE, 'r', encoding='utf-8') as f:
            try:
                GEO_CACHE = json.load(f)
                print(f"📦 Loaded {len(GEO_CACHE)} cached locations.")
            except:
                GEO_CACHE = {}

def save_cache():
    with open(CACHE_FILE, 'w', encoding='utf-8') as f:
        json.dump(GEO_CACHE, f)

load_cache()

# --- SCHEMA DEFINITIONS ---
# Prompts for Pydantic models to parse AI output

class Logistics(BaseModel):
    price_text: Optional[str] = Field(None, description="Raw price text e.g. '$20' or 'Free entry'")
    hours: Optional[str] = Field(None, description="Opening hours")
    address: Optional[str] = Field(None, description="Physical address")
    transport: Optional[str] = Field(None, description="Metro/Bus info")
    model_config = ConfigDict(extra='forbid')

class ExtractedAttraction(BaseModel):
    name: str = Field(..., description="Official name of the attraction")
    detected_city: str = Field(..., description="The city this specific attraction is located in (e.g. Budapest, Prague).")
    
    category: str = Field(..., description="General category: Landmark, Museum, Park, Food, Shopping")
    vibes: List[str] = Field(..., description="3-5 adjectives describing the mood")
    
    price_level: Literal['Free', 'Cheap', 'Moderate', 'Expensive', 'Luxury', 'Unknown'] = Field(..., description="Estimated price tier")
    popularity_keywords: List[str] = Field(..., description="Keywords found in text like 'famous', 'crowded', 'hidden gem'")
    
    rating_score: Optional[float] = Field(None, description="The numerical rating given (e.g. 4.5).")
    rating_max: Optional[float] = Field(None, description="The scale of the rating (e.g. 5.0).")
    review_count_mentioned: Optional[int] = Field(0, description="Review count if mentioned.")
    
    logistics: Logistics = Field(..., description="Structured facts")
    description_summary: str = Field(..., description="2-3 sentence summary.")
    source_quote_or_summary: str = Field(..., description="What THIS source says.")
    
    model_config = ConfigDict(extra='forbid')

class ArticleExtraction(BaseModel):
    attractions: List[ExtractedAttraction]
    model_config = ConfigDict(extra='forbid')

# --- HELPERS ---

def get_place_name_from_key(s3_key):
    """
    Extract location name from S3 key.
    Examples:
      - raw_scrapes/budapest_20231113.jsonl -> budapest
      - raw_scrapes/paris_2024_01_15.jsonl -> paris
    """
    filename = os.path.basename(s3_key)
    # Remove extension and timestamp patterns
    name = filename.replace('.jsonl', '')
    # Extract location name (everything before first underscore or number)
    match = re.match(r"([a-zA-Z\s]+)", name)
    if match:
        location = match.group(1).strip()
        return location if location else "Unknown Destination"
    return "Unknown Destination"

def trigger_main_scraper(location):
    """
    Triggers main_scraper.py to fetch fresh data for a location.
    Returns True if successful, False otherwise.
    """
    scraper_path = repo_root / "web_scraper" / "code" / "1. main_scraper.py"
    
    if not scraper_path.exists():
        with PRINT_LOCK:
            print(f"⚠️ main_scraper.py not found at: {scraper_path}")
        return False
    
    with PRINT_LOCK:
        print(f"\n🔄 Triggering fresh scrape for: {location}")
        print(f"   This may take 5-15 minutes...")
    
    try:
        # Run main_scraper with the location as input
        result = subprocess.run(
            [sys.executable, str(scraper_path)],
            input=location,
            text=True,
            capture_output=False,  # Show output in real-time
            timeout=1800  # 30 minute timeout
        )
        
        if result.returncode == 0:
            with PRINT_LOCK:
                print(f"✅ Scraping completed for {location}")
            return True
        else:
            with PRINT_LOCK:
                print(f"⚠️ Scraping failed with return code: {result.returncode}")
            return False
            
    except subprocess.TimeoutExpired:
        with PRINT_LOCK:
            print(f"⚠️ Scraping timeout for {location}")
        return False
    except Exception as e:
        with PRINT_LOCK:
            print(f"⚠️ Error triggering scraper: {e}")
        return False

def log_status(s3_key, status, msg=None):
    try:
        supabase.table("processed_scraped_data").upsert({
            "s3_key": s3_key,
            "processed_at": datetime.datetime.now().isoformat(),
            "status": status,
        }).execute()
    except Exception as e: print(f"⚠️ Log Error: {e}")

def should_process(s3_key, force_refresh=False, check_staleness=True):
    """
    Determines if an S3 file should be processed.
    
    Args:
        s3_key: The S3 key to check
        force_refresh: If True, always process regardless of status
        check_staleness: If True, check if data is older than 3 months
    
    Returns:
        Tuple (should_process: bool, is_stale: bool)
    """
    if force_refresh:
        return (True, False)
    
    try:
        res = supabase.table("processed_scraped_data").select("status, processed_at").eq("s3_key", s3_key).execute()
        
        if not res.data:
            return (True, False)
        
        record = res.data[0]
        status = record.get('status')
        processed_at = record.get('processed_at')
        
        # If processing failed before, retry
        if status == 'failed':
            return (True, False)
        
        # If successful, check staleness
        if status == 'success' and check_staleness and processed_at:
            try:
                processed_date = datetime.datetime.fromisoformat(processed_at.replace('Z', '+00:00'))
                now = datetime.datetime.now(datetime.timezone.utc)
                age = now - processed_date
                
                # If data is older than 3 months (90 days), needs refresh
                if age > timedelta(days=90):
                    with PRINT_LOCK:
                        print(f"⏰ Data is {age.days} days old (>90 days). Needs refresh...")
                    return (True, True)  # Process AND it's stale
            except Exception as e:
                with PRINT_LOCK:
                    print(f"⚠️ Error parsing date: {e}. Will reprocess.")
                return (True, False)
        
        # If recent and successful, skip
        if status == 'success':
            return (False, False)
            
        return (True, False)
    except Exception as e:
        with PRINT_LOCK:
            print(f"⚠️ Error checking process status: {e}")
        return (True, False)

def generate_embedding(text):
    try:
        clean = text.replace("\n", " ")
        res = openai_client.embeddings.create(input=[clean], model="text-embedding-3-small")
        return res.data[0].embedding
    except: return None

def infer_popularity(item):
    if item.review_count_mentioned and item.review_count_mentioned > 0:
        return min(100, int(item.review_count_mentioned / 10))
    score = 10 
    keywords = [k.lower() for k in item.popularity_keywords]
    if any(w in keywords for w in ['iconic', 'famous', 'must-see', 'landmark']): score += 50
    if any(w in keywords for w in ['popular', 'crowded', 'busy']): score += 30
    if any(w in keywords for w in ['hidden gem', 'quiet', 'secret']): score += 10 
    return min(100, score)

def parse_place_parts(place_str):
    if not place_str:
        return None, None
    parts = [p.strip() for p in place_str.split(",") if p.strip()]
    if not parts:
        return None, None
    city = parts[0]
    country = parts[-1] if len(parts) > 1 else None
    return city, country

def resolve_geo_cached(query, ref_lat=None, ref_lon=None, country_hint=None):
    # 1. Fast Cache Check (Thread Safe Read)
    with CACHE_LOCK:
        cached = GEO_CACHE.get(query, "__missing__")

    if cached != "__missing__":
        if cached and country_hint and cached.get("country") and cached.get("country") != country_hint:
            cached = "__mismatch__"
        elif cached is None and country_hint:
            cached = "__mismatch__"
        else:
            return cached

    # 2. API CALL - STRICTLY SERIALIZED
    # This block ensures only ONE thread hits OpenStreetMap at a time
    with GEO_API_LOCK:
        time.sleep(1.2) # Sleep inside the lock to force the gap
        
        try:
            loc = geolocator.geocode(query, addressdetails=True, language='en', timeout=10)
            result = None
            if loc:
                addr = loc.raw.get('address', {})
                lat, lon = loc.latitude, loc.longitude
                dist = 0.0
                if ref_lat and ref_lon:
                    dist = geodesic((ref_lat, ref_lon), (lat, lon)).km
                
                result = {
                    "lat": lat, "lon": lon,
                    "city": addr.get('city', addr.get('town', addr.get('village', 'Unknown'))),
                    "state": addr.get('state'),
                    "country": addr.get('country'),
                    "dist": dist
                }
            
            # Save to Cache immediately
            with CACHE_LOCK:
                GEO_CACHE[query] = result
                save_cache()
                
            return result
        except Exception as e:
            with PRINT_LOCK: print(f"      ⚠️ GeoAPI Error: {e}")
            return None

def analyze_chunk(text, title, source, idx=None, total=None):
    if idx is not None and total is not None:
        with PRINT_LOCK: print(f"   🧠 Analyzing chunk ({len(text)} chars)... [{idx}/{total}]")
    else:
        with PRINT_LOCK: print(f"   🧠 Analyzing chunk ({len(text)} chars)...")
    prompt = f"""
    You are a Travel Data Extractor. Source: {source}. Title: {title}.
    Extract attractions.
    IMPORTANT: Identify the 'detected_city' for each attraction (e.g. if the article mentions Budapest, label 'Chain Bridge' as 'Budapest').
    Infer 'popularity_keywords' and 'price_level'.
    """
    try:
        completion = openai_client.beta.chat.completions.parse(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "Extract structured travel data."},
                {"role": "user", "content": f"{prompt}\n\nTEXT:\n{text[:15000]}"} 
            ],
            response_format=ArticleExtraction,
        )
        return completion.choices[0].message.parsed.attractions
    except Exception as e:
        with PRINT_LOCK: print(f"   ⚠️ AI Error: {e}")
        return []

# --- PRE-EXTRACTED SUPPORT ---

def build_extracted_from_pre(raw: Dict[str, Any], fallback_city: Optional[str] = None) -> ExtractedAttraction:
    name = raw.get("name") or raw.get("attraction_name") or "Unknown"
    detected_city = raw.get("detected_city") or raw.get("city") or fallback_city or "Unknown"
    category = raw.get("category") or "Attraction"
    vibes = raw.get("vibes") or []
    popularity_keywords = raw.get("popularity_keywords") or []
    price_level = raw.get("price_level") or "Unknown"
    rating_score = raw.get("rating_score") or raw.get("rating")
    rating_max = raw.get("rating_max") or (5.0 if rating_score is not None else None)
    review_count_mentioned = raw.get("review_count_mentioned") or raw.get("num_reviews") or 0
    logistics_raw = raw.get("logistics") or {}
    logistics = Logistics(
        price_text=logistics_raw.get("price_text") or raw.get("price_text"),
        hours=logistics_raw.get("hours") or raw.get("hours"),
        address=logistics_raw.get("address") or raw.get("address"),
        transport=logistics_raw.get("transport") or raw.get("transport"),
    )
    description_summary = raw.get("description_summary") or raw.get("summary") or f"TripAdvisor listing for {name}."
    source_quote_or_summary = raw.get("source_quote_or_summary") or raw.get("source_summary") or description_summary

    return ExtractedAttraction(
        name=name,
        detected_city=detected_city,
        category=category,
        vibes=vibes,
        price_level=price_level,
        popularity_keywords=popularity_keywords,
        rating_score=rating_score,
        rating_max=rating_max,
        review_count_mentioned=review_count_mentioned,
        logistics=logistics,
        description_summary=description_summary,
        source_quote_or_summary=source_quote_or_summary,
    )


def is_missing_value(value):
    if value is None:
        return True
    if isinstance(value, str) and not value.strip():
        return True
    if isinstance(value, list) and len(value) == 0:
        return True
    return False


def merge_extracted(pre: ExtractedAttraction, ai: ExtractedAttraction) -> ExtractedAttraction:
    pre_dict = pre.model_dump()
    ai_dict = ai.model_dump()

    merged = dict(pre_dict)
    for key, ai_val in ai_dict.items():
        if key == "logistics":
            pre_log = pre_dict.get("logistics") or {}
            ai_log = ai_dict.get("logistics") or {}
            merged_log = dict(pre_log)
            for lkey, lval in ai_log.items():
                if is_missing_value(merged_log.get(lkey)):
                    merged_log[lkey] = lval
            merged["logistics"] = merged_log
            continue

        if is_missing_value(merged.get(key)):
            merged[key] = ai_val

    return ExtractedAttraction(**merged)


def find_ai_match(pre_item: ExtractedAttraction, ai_items: List[ExtractedAttraction]) -> Optional[ExtractedAttraction]:
    pre_name = (pre_item.name or "").strip().lower()
    for ai_item in ai_items:
        if (ai_item.name or "").strip().lower() == pre_name:
            return ai_item
    return ai_items[0] if ai_items else None

# --- CORE LOGIC ---

def download_s3(s3_key):
    print(f"⬇️  Downloading {s3_key}...")
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        s3.download_fileobj(S3_BUCKET, s3_key, tmp)
        return tmp.name

def delete_old_s3_files(location, current_s3_key):
    """
    Deletes old S3 files for a location, keeping only the current one.
    
    Args:
        location: The location name (e.g., 'budapest')
        current_s3_key: The S3 key to keep (newly processed file)
    """
    try:
        location_lower = location.lower().replace(' ', '_')
        with PRINT_LOCK:
            print(f"🗑️  Cleaning up old files for {location}...")
        
        # List all files for this location
        paginator = s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=f'raw_scrapes/{location_lower}')
        
        files_to_delete = []
        for page in pages:
            if 'Contents' in page:
                for obj in page['Contents']:
                    key = obj['Key']
                    # Delete if it's a .jsonl file for this location and NOT the current file
                    if key.endswith('.jsonl') and key != current_s3_key:
                        files_to_delete.append(key)
        
        if files_to_delete:
            for old_key in files_to_delete:
                s3.delete_object(Bucket=S3_BUCKET, Key=old_key)
                with PRINT_LOCK:
                    print(f"   ✓ Deleted: {old_key}")
            with PRINT_LOCK:
                print(f"   Removed {len(files_to_delete)} old file(s)")
        else:
            with PRINT_LOCK:
                print(f"   No old files to delete")
                
    except Exception as e:
        with PRINT_LOCK:
            print(f"⚠️ Error deleting old files: {e}")

def save_attraction(item, place_id, source_id, article, s3_key, ref_lat, ref_lon, main_place_name, p_country):
    price_map = {'Free': 0, 'Cheap': 1, 'Moderate': 2, 'Expensive': 3, 'Luxury': 4, 'Unknown': None}
    price_int = price_map.get(item.price_level, None)

    # Geo Logic
    detected_city, detected_country = parse_place_parts(item.detected_city) if item.detected_city else (None, None)
    search_city = detected_city or main_place_name
    address_text = None
    if item.logistics and item.logistics.address:
        address_text = item.logistics.address

    if address_text:
        query = f"{item.name}, {address_text}"
        if detected_country and detected_country not in address_text:
            query = f"{query}, {detected_country}"
        elif p_country and p_country not in address_text:
            query = f"{query}, {p_country}"
    elif p_country and p_country != "Unknown":
        query = f"{item.name}, {search_city}, {p_country}"
    else:
        query = f"{item.name}, {search_city}"

    with PRINT_LOCK: print(f"      📍 Geocoding: {item.name} in {search_city}...")
    
    attr_geo = resolve_geo_cached(query, ref_lat, ref_lon, country_hint=detected_country or p_country)
    if not attr_geo:
        attr_geo = resolve_geo_cached(item.name, ref_lat, ref_lon, country_hint=detected_country or p_country)

    lat, lon, dist = (None, None, None)
    city, state, country = (search_city, None, detected_country or p_country)

    if attr_geo:
        lat, lon, dist = attr_geo['lat'], attr_geo['lon'], attr_geo['dist']
        if dist > 2000:
             lat, lon, dist = (ref_lat, ref_lon, 0)
        else:
            if attr_geo['city']: city = attr_geo['city']
            state = attr_geo.get('state') or attr_geo.get('region') or attr_geo.get('state_district')
            if attr_geo['country']: country = attr_geo['country']

    # Calculations
    pop_score = infer_popularity(item)
    cred_tier = 3 if article.get('trust_score', 50) > 80 else 2
    
    norm_rating = None
    if item.rating_score:
        scale = item.rating_max or 5.0
        norm_rating = (item.rating_score / scale) * 10.0

    # 1. UPSERT PARENT ATTRACTION
    attr_data = {
        'place_id': place_id,
        'attraction_name': item.name,
        'attraction_summary': item.description_summary,
        'attraction_vibe': item.vibes,
        'attraction_rawdata': item.logistics.model_dump(exclude_none=True),
        'attraction_embedding': generate_embedding(f"{item.name}: {item.description_summary} Vibe: {', '.join(item.vibes)}"),
        'attraction_city': city,
        'attraction_stateprovince': state,
        'attraction_countryregion': country,
        'attraction_latitude': lat,
        'attraction_longitude': lon,
        'attraction_distancefromplace': dist,
        'attraction_lastrefreshed': datetime.datetime.now().isoformat(),
        'attraction_credibilitytier': cred_tier,
        'attraction_pricelevel': price_int,
        'attraction_popularityscore': pop_score,
        'attraction_normalizedrating': norm_rating,
        'attraction_totalcountratings': item.review_count_mentioned
    }
    
    res = supabase.table('attraction').upsert(attr_data, on_conflict='attraction_name,place_id').execute()
    attr_id = res.data[0]['attraction_id']

    # 2. LINK CATEGORIES
    cat_res = supabase.table('category').upsert({'category_name': item.category}, on_conflict='category_name').execute()
    cat_id = cat_res.data[0]['category_id']
    supabase.table('attraction_categories').upsert(
        {'attraction_id': attr_id, 'category_id': cat_id}, 
        on_conflict='attraction_id,category_id'
    ).execute()

    # 3. LINK SOURCE
    source_link_data = {
        'attraction_id': attr_id,
        'source_id': source_id,
        'attraction_sources_url': article['url'],
        'attraction_sources_filename': os.path.basename(s3_key),
        'attraction_sources_rawtext': article.get('content_body', ''),
        'attraction_sources_sourcesummary': item.source_quote_or_summary,
        'attraction_sources_rating': item.rating_score,
        'attraction_sources_maxrating': item.rating_max,
        'attraction_sources_countratings': item.review_count_mentioned,
        'attraction_sources_shortreview': f"{item.source_quote_or_summary[:50]}..."
    }

    try:
        # Changed to upsert to handle duplicates if source_id+attraction_id are unique
        supabase.table('attraction_sources').upsert(
            source_link_data, 
            on_conflict='attraction_id,source_id'
        ).execute()
    except Exception as e:
        with PRINT_LOCK: print(f"      ⚠️ Link Error: {e}")

def process_single_article(article, place_id, s3_key, p_lat, p_lon, main_place_name, p_country, idx=None, total=None):
    if not article:
        return
    try:
        content = article.get('content_body', article.get('content', ''))
        if not content: return

        parsed_domain = urlparse(article['url']).netloc.replace('www.', '')
        trust = 50
        if any(x in parsed_domain for x in ['ricksteves', 'lonelyplanet', 'natgeo']): trust = 90
        elif any(x in parsed_domain for x in ['reddit', 'tripadvisor']): trust = 60
        
        src_data = {
            'source_name': article['source'], 
            'source_domain': parsed_domain, 
            'trust_score': trust
        }
        src_res = supabase.table('source').upsert(src_data, on_conflict='source_name').execute()
        source_id = src_res.data[0]['source_id']
        
        pre_extracted = article.get("pre_extracted_attractions") or article.get("extracted_attractions")
        if isinstance(pre_extracted, list) and pre_extracted:
            with PRINT_LOCK: print("   ✅ Pre-extracted found; filling missing fields with AI.")
            pre_items = []
            for raw in pre_extracted:
                try:
                    pre_items.append(build_extracted_from_pre(raw, article.get("seed_place") or main_place_name))
                except Exception as e:
                    with PRINT_LOCK: print(f"   ⚠️ Pre-extracted item error: {e}")

            ai_items = analyze_chunk(content, article.get('title'), article.get('source'), idx, total)
            if not ai_items:
                attractions = pre_items
            else:
                attractions = []
                for pre_item in pre_items:
                    ai_match = find_ai_match(pre_item, ai_items)
                    attractions.append(merge_extracted(pre_item, ai_match) if ai_match else pre_item)
        else:
            attractions = analyze_chunk(content, article.get('title'), article.get('source'), idx, total)
        
        for item in attractions:
            save_attraction(item, place_id, source_id, article, s3_key, p_lat, p_lon, main_place_name, p_country)
            
    except Exception as e:
        with PRINT_LOCK: print(f"❌ Error processing article: {e}")

def process_file_content(local_path, s3_key, main_place_name):
    print(f"   🌍 resolving main place: {main_place_name}")

    def resolve_place_cached(place_name, cache):
        if place_name in cache:
            return cache[place_name]

        place_city_name, country_hint = parse_place_parts(place_name)
        place_city_name = place_city_name or place_name

        query = f"{place_city_name}, {country_hint}" if country_hint else place_city_name
        main_geo = resolve_geo_cached(query, country_hint=country_hint)
        p_lat, p_lon = (None, None)
        p_country, p_state = (country_hint or "Unknown", None)

        if main_geo:
            if not country_hint or main_geo.get('country') == country_hint:
                p_lat, p_lon = main_geo['lat'], main_geo['lon']
            p_state = main_geo.get('state')
            if main_geo.get('country') and not country_hint:
                p_country = main_geo['country']

        place_data = {
            'place_city': place_city_name,
            'place_countryregion': p_country,
            'place_stateprovince': p_state,
            'place_latitude': p_lat,
            'place_longitude': p_lon,
            'place_type': ['city'],
            'place_lastrefreshed': datetime.datetime.now().isoformat()
        }
        place_res = supabase.table('place').upsert(place_data, on_conflict='place_city').execute()
        place_id = place_res.data[0]['place_id']
        cache[place_name] = (place_id, p_lat, p_lon, p_country, p_state, place_city_name)
        return cache[place_name]

    with open(local_path, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    total = len(lines)
    print(f"   🚀 Starting parallel processing for {total} articles...")
    
    # Reduced max_workers to 3 to prevent Socket errors
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        futures = []
        place_cache = {}
        for idx, line in enumerate(lines, start=1):
            if not line.strip():
                continue
            try:
                article = json.loads(line)
            except Exception as e:
                with PRINT_LOCK: print(f"❌ Error parsing article: {e}")
                continue

            place_name = article.get("seed_place") or main_place_name
            place_id, p_lat, p_lon, p_country, _, place_city_name = resolve_place_cached(place_name, place_cache)
            futures.append(
                executor.submit(
                    process_single_article,
                    article,
                    place_id,
                    s3_key,
                    p_lat,
                    p_lon,
                    place_city_name,
                    p_country,
                    idx,
                    total
                )
            )
        concurrent.futures.wait(futures)

def process_pipeline(s3_key, force_refresh=False, check_staleness=True, trigger_scraper=True):
    """
    Main processing pipeline for an S3 file.
    
    Args:
        s3_key: The S3 key to process
        force_refresh: If True, process even if recently processed
        check_staleness: If True, refresh data older than 3 months
        trigger_scraper: If True, trigger main_scraper for stale data
    """
    should_proc, is_stale = should_process(s3_key, force_refresh, check_staleness)
    
    if not should_proc:
        with PRINT_LOCK:
            print(f"⏭️  SKIPPING (already processed): {s3_key}")
        return
    
    location = get_place_name_from_key(s3_key)
    original_s3_key = s3_key
    scraped_fresh_data = False
    
    # If data is stale and scraper trigger is enabled, fetch fresh data first
    if is_stale and trigger_scraper:
        with PRINT_LOCK:
            print(f"\n🔄 Data is stale for {location}. Fetching fresh data...")
        
        scrape_success = trigger_main_scraper(location)
        
        if scrape_success:
            # Wait a moment for S3 to finalize the upload
            time.sleep(2)
            
            # Find the newly created file in S3 for this location
            with PRINT_LOCK:
                print(f"🔍 Looking for newly scraped file for {location}...")
            
            try:
                # List files for this location, sorted by last modified
                location_lower = location.lower().replace(' ', '_')
                paginator = s3.get_paginator('list_objects_v2')
                pages = paginator.paginate(Bucket=S3_BUCKET, Prefix=f'raw_scrapes/{location_lower}')
                
                files = []
                for page in pages:
                    if 'Contents' in page:
                        files.extend([obj for obj in page['Contents'] if obj['Key'].endswith('.jsonl')])
                
                if files:
                    # Get the most recent file
                    newest_file = max(files, key=lambda x: x['LastModified'])
                    s3_key = newest_file['Key']
                    scraped_fresh_data = True
                    with PRINT_LOCK:
                        print(f"✅ Found new file: {s3_key}")
                else:
                    with PRINT_LOCK:
                        print(f"⚠️ No new file found. Processing existing file.")
            except Exception as e:
                with PRINT_LOCK:
                    print(f"⚠️ Error finding new file: {e}. Processing existing file.")
        else:
            with PRINT_LOCK:
                print(f"⚠️ Scraping failed. Will process existing old file.")
    
    print(f"\n▶️  STARTING: {s3_key}")
    try:
        local_path = download_s3(s3_key)
        place_name = get_place_name_from_key(s3_key)
        process_file_content(local_path, s3_key, place_name)
        log_status(s3_key, 'success')
        
        # After successful processing, delete old S3 files if we scraped fresh data
        if scraped_fresh_data:
            delete_old_s3_files(location, s3_key)
        
        print(f"🎉 COMPLETED: {s3_key}")
    except Exception as e:
        print(f"❌ CRITICAL ERROR: {e}")
        log_status(s3_key, 'failed', str(e))
    finally:
        if 'local_path' in locals() and os.path.exists(local_path):
            os.remove(local_path)

def main():
    """
    Main function to process S3 files with optional refresh control.
    """
    parser = argparse.ArgumentParser(
        description='Process travel data from S3 and populate Supabase database.'
    )
    parser.add_argument(
        '--force-refresh',
        action='store_true',
        help='Force reprocessing of all files regardless of when they were last processed'
    )
    parser.add_argument(
        '--refresh-stale',
        action='store_true',
        help='Refresh data that is older than 3 months (default behavior)'
    )
    parser.add_argument(
        '--no-staleness-check',
        action='store_true',
        help='Skip the 3-month staleness check (only process new or failed files)'
    )
    parser.add_argument(
        '--s3-key',
        type=str,
        help='Process a specific S3 key instead of scanning the entire bucket'
    )
    parser.add_argument(
        '--no-scraper',
        action='store_true',
        help='Do not trigger main_scraper for stale data (only reprocess existing files)'
    )
    
    args = parser.parse_args()
    
    # Determine processing mode
    force_refresh = args.force_refresh
    check_staleness = not args.no_staleness_check or args.refresh_stale
    trigger_scraper = not args.no_scraper
    
    if force_refresh:
        print("🔄 FORCE REFRESH MODE: Will reprocess all files")
    elif check_staleness:
        print("⏰ STALENESS CHECK ENABLED: Will refresh data older than 3 months")
    else:
        print("📋 NORMAL MODE: Only processing new or failed files")
    
    if not trigger_scraper:
        print("⚠️ Scraper disabled: Will only reprocess existing files")
    
    # Process specific file or scan bucket
    if args.s3_key:
        print(f"🎯 Processing specific file: {args.s3_key}")
        process_pipeline(args.s3_key, force_refresh, check_staleness, trigger_scraper)
    else:
        print(f"🔎 Scanning S3 bucket '{S3_BUCKET}'...")
        paginator = s3.get_paginator('list_objects_v2')
        pages = paginator.paginate(Bucket=S3_BUCKET, Prefix='raw_scrapes/')
        
        files_to_process = []
        for page in pages:
            if 'Contents' not in page:
                continue
            for obj in page['Contents']:
                if obj['Key'].endswith('.jsonl'):
                    files_to_process.append(obj['Key'])
        
        print(f"📊 Found {len(files_to_process)} .jsonl files")
        
        for s3_key in files_to_process:
            process_pipeline(s3_key, force_refresh, check_staleness, trigger_scraper)
    
    print("\n✅ Processing complete!")

if __name__ == "__main__":
    main()