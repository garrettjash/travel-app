import json
import os
import boto3
import tempfile
import datetime
import re
import time
import concurrent.futures
import threading
from urllib.parse import urlparse
from typing import List, Optional, Literal
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
    filename = os.path.basename(s3_key)
    match = re.match(r"([a-zA-Z]+)", filename)
    if match: return match.group(1).title()
    return "Unknown Destination"

def log_status(s3_key, status, msg=None):
    try:
        supabase.table("processed_scraped_data").upsert({
            "s3_key": s3_key,
            "processed_at": datetime.datetime.now().isoformat(),
            "status": status,
        }).execute()
    except Exception as e: print(f"⚠️ Log Error: {e}")

def should_process(s3_key):
    try:
        res = supabase.table("processed_scraped_data").select("status").eq("s3_key", s3_key).execute()
        if res.data and res.data[0]['status'] == 'success': return False
        return True
    except: return True

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

# --- CORE LOGIC ---

def download_s3(s3_key):
    print(f"⬇️  Downloading {s3_key}...")
    with tempfile.NamedTemporaryFile(delete=False) as tmp:
        s3.download_fileobj(S3_BUCKET, s3_key, tmp)
        return tmp.name

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
            'place_type': ['city']
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

def process_pipeline(s3_key):
    if not should_process(s3_key): return
    print(f"\n▶️  STARTING: {s3_key}")
    try:
        local_path = download_s3(s3_key)
        place_name = get_place_name_from_key(s3_key)
        process_file_content(local_path, s3_key, place_name)
        log_status(s3_key, 'success')
        print(f"🎉 COMPLETED: {s3_key}")
    except Exception as e:
        print(f"❌ CRITICAL ERROR: {e}")
        log_status(s3_key, 'failed', str(e))
    finally:
        if 'local_path' in locals() and os.path.exists(local_path):
            os.remove(local_path)

if __name__ == "__main__":
    print(f"🔎 Scanning S3 bucket '{S3_BUCKET}'...")
    paginator = s3.get_paginator('list_objects_v2')
    pages = paginator.paginate(Bucket=S3_BUCKET, Prefix='raw_scrapes/')
    for page in pages:
        if 'Contents' not in page: continue
        for obj in page['Contents']:
            if obj['Key'].endswith('.jsonl'):
                process_pipeline(obj['Key'])