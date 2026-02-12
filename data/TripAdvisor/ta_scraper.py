import os
import time
import json
import boto3
import requests
import importlib.util
import sys
from pathlib import Path
from datetime import datetime, timezone

try:
    from dotenv import load_dotenv
except ImportError as exc:
    raise ImportError(
        "python-dotenv is not installed. Run `pip install python-dotenv` and re-run this script."
    ) from exc

# --- ENV LOADING ---
repo_root = Path(__file__).resolve().parents[2]
load_dotenv(repo_root / ".env.local")
load_dotenv(repo_root / ".env")

# --- CONFIG ---
API_KEY = os.getenv("TA_API_KEY")
S3_BUCKET = os.getenv("S3_BUCKET_NAME")
S3_PREFIX = "raw_scrapes/"
TA_SEED_PLACE_ENV = os.getenv("TA_SEED_PLACE")

if not API_KEY:
    raise RuntimeError("Set TA_API_KEY in your environment.")

DATA_DIR = Path(__file__).resolve().parent
CACHE_DIR = DATA_DIR / "ta_cache"
CACHE_DIR.mkdir(exist_ok=True)

# If True, discover attractions by scanning lat/lon grids in bounding boxes.
USE_BOUNDING_BOXES = True
BOUNDING_BOXES = [
    {
        "name": "us_northeast",
        "min_lat": 38.0,
        "max_lat": 43.5,
        "min_lon": -78.0,
        "max_lon": -71.0,
        "step_deg": 1.0,
    },
]

# Optional seed places if USE_BOUNDING_BOXES = False
SEED_PLACES = []

# --- OPTIONAL USER SEED + WEB SCRAPER BRIDGE ---
USE_INTERACTIVE_SEED = True
WEB_SCRAPER_PATH = repo_root / "web_scraper" / "code" / "1. main_scraper.py"

def load_web_scraper():
    if not WEB_SCRAPER_PATH.exists():
        print(f"⚠️ Web scraper not found at: {WEB_SCRAPER_PATH}")
        return None
    try:
        # Ensure sibling imports (e.g., selenium_scraper.py) resolve correctly.
        scraper_dir = str(WEB_SCRAPER_PATH.parent)
        if scraper_dir not in sys.path:
            sys.path.insert(0, scraper_dir)
        spec = importlib.util.spec_from_file_location("main_scraper", WEB_SCRAPER_PATH)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module
    except Exception as exc:
        print(f"⚠️ Failed to load web scraper: {exc}")
        return None

def prompt_seed_place():
    if not USE_INTERACTIVE_SEED:
        return None
    if TA_SEED_PLACE_ENV:
        return TA_SEED_PLACE_ENV.strip()
    try:
        raw = input("Enter seed place (leave blank to use bounding boxes): ").strip()
    except EOFError:
        return None
    return raw or None

def maybe_run_web_scraper(place_name):
    if not place_name:
        return
    if os.getenv("TA_SKIP_WEB_SCRAPER"):
        return
    module = load_web_scraper()
    if not module:
        return
    scraper_fn = getattr(module, "scrape_and_crawl", None)
    if not scraper_fn:
        print("⚠️ Web scraper missing scrape_and_crawl()")
        return
    print(f"🌐 Running web scraper for: {place_name}")
    scraper_fn(place_name)

# --- API HELPERS ---
BASE = "https://api.content.tripadvisor.com/api/v1"
HEADERS = {"accept": "application/json"}


def ta_get(path, params=None, sleep_s=0.25, retries=3):
    """GET wrapper with light retry/backoff + polite pacing."""
    params = dict(params or {})
    params["key"] = API_KEY
    url = f"{BASE}{path}"

    last_err = None
    for i in range(retries):
        try:
            r = requests.get(url, headers=HEADERS, params=params, timeout=30)
            if r.status_code == 429:
                time.sleep(sleep_s * (2 ** i))
                continue
            if r.status_code != 200:
                raise RuntimeError(f"HTTP {r.status_code}: {r.text[:400]}")
            time.sleep(sleep_s)
            return r.json()
        except Exception as e:
            last_err = e
            time.sleep(sleep_s * (2 ** i))
    raise last_err


def location_search(search_query, category=None, language="en"):
    params = {"searchQuery": search_query, "language": language}
    if category:
        params["category"] = category
    j = ta_get("/location/search", params=params)
    return j.get("data", [])


def pick_best_geo_result(query, candidates):
    q = query.lower()
    scored = []
    for c in candidates:
        name = (c.get("name") or "").lower()
        loc_id = c.get("location_id")
        score = 0
        if loc_id:
            score += 5
        if name and (name in q or q in name):
            score += 10
        addr = c.get("address_obj") or {}
        if addr.get("country"):
            score += 1
        if addr.get("city"):
            score += 1
        scored.append((score, c))
    scored.sort(key=lambda x: x[0], reverse=True)
    return scored[0][1] if scored else None


def location_details(location_id, language="en", currency="USD"):
    cache_path = CACHE_DIR / f"details_{location_id}.json"
    if cache_path.exists():
        return json.loads(cache_path.read_text("utf-8"))
    j = ta_get(f"/location/{location_id}/details", params={"language": language, "currency": currency})
    cache_path.write_text(json.dumps(j, ensure_ascii=False, indent=2), encoding="utf-8")
    return j


def nearby_search(lat, lon, category="attractions", radius=10, radius_unit="mi", language="en"):
    j = ta_get("/location/nearby_search", params={
        "latLong": f"{lat},{lon}",
        "category": category,
        "radius": radius,
        "radiusUnit": radius_unit,
        "language": language
    })
    return j.get("data", [])


def iter_bbox_points(min_lat, max_lat, min_lon, max_lon, step_deg):
    lat = min_lat
    while lat <= max_lat:
        lon = min_lon
        while lon <= max_lon:
            yield lat, lon
            lon += step_deg
        lat += step_deg


def flatten_details(d):
    addr = d.get("address_obj") or {}
    return {
        "location_id": d.get("location_id"),
        "name": d.get("name"),
        "web_url": d.get("web_url"),
        "rating": d.get("rating"),
        "num_reviews": d.get("num_reviews"),
        "ranking_string": d.get("ranking_string"),
        "latitude": d.get("latitude"),
        "longitude": d.get("longitude"),
        "address": addr.get("address_string"),
        "city": addr.get("city"),
        "state": addr.get("state"),
        "country": addr.get("country"),
        "phone": d.get("phone"),
        "website": d.get("website"),
        "price_level": d.get("price_level"),
    }


# --- RESOLVE SEEDS (optional) ---
top_places = {}
unresolved = []
user_seed = prompt_seed_place()
if user_seed:
    USE_BOUNDING_BOXES = False
    SEED_PLACES = [user_seed]
    maybe_run_web_scraper(user_seed)

if not USE_BOUNDING_BOXES:
    for place in SEED_PLACES:
        try:
            candidates = location_search(place, category="geos")
            best = pick_best_geo_result(place, candidates)
            if not best or not best.get("location_id"):
                unresolved.append({"seed": place, "reason": "no_best_match"})
                continue

            loc_id = best["location_id"]
            addr = best.get("address_obj") or {}
            top_places[loc_id] = {
                "seed": place,
                "name": best.get("name"),
                "address_string": addr.get("address_string"),
            }
        except Exception as e:
            unresolved.append({"seed": place, "reason": str(e)})

# --- DISCOVER ATTRACTIONS ---
RADIUS_MILES = 10
attractions_map = {}
seed_errors = []

if USE_BOUNDING_BOXES:
    for box in BOUNDING_BOXES:
        box_name = box["name"]
        for lat, lon in iter_bbox_points(
            box["min_lat"], box["max_lat"], box["min_lon"], box["max_lon"], box["step_deg"]
        ):
            try:
                nearby = nearby_search(lat, lon, category="attractions", radius=RADIUS_MILES, radius_unit="mi")
                for item in nearby:
                    aid = item.get("location_id")
                    if not aid:
                        continue
                    if aid not in attractions_map:
                        attractions_map[aid] = {
                            "name": item.get("name"),
                            "seed_geo_id": None,
                            "seed_place": f"bbox:{box_name}",
                        }
            except Exception as e:
                seed_errors.append({"seed_geo_id": None, "seed": box_name, "error": str(e)})
else:
    for seed_geo_id, meta in top_places.items():
        try:
            geo = location_details(seed_geo_id)
            lat = geo.get("latitude")
            lon = geo.get("longitude")
            if lat is None or lon is None:
                seed_errors.append({"seed_geo_id": seed_geo_id, "seed": meta["seed"], "error": "missing lat/lon"})
                continue

            nearby = nearby_search(lat, lon, category="attractions", radius=RADIUS_MILES, radius_unit="mi")
            for item in nearby:
                aid = item.get("location_id")
                if not aid:
                    continue
                if aid not in attractions_map:
                    attractions_map[aid] = {
                        "name": item.get("name"),
                        "seed_geo_id": seed_geo_id,
                        "seed_place": meta["seed"],
                    }
        except Exception as e:
            seed_errors.append({"seed_geo_id": seed_geo_id, "seed": meta["seed"], "error": str(e)})

print("Unique attractions found:", len(attractions_map))
print("Seed geo errors:", len(seed_errors))

# --- INCREMENTAL DETAILS FETCH ---
STATE_PATH = DATA_DIR / "ta_state.json"
ATTRACTIONS_PATH = DATA_DIR / "attractions.json"

existing_rows = []
existing_ids = set()
if ATTRACTIONS_PATH.exists():
    with open(ATTRACTIONS_PATH, "r", encoding="utf-8") as f:
        try:
            existing_rows = json.load(f)
        except json.JSONDecodeError:
            existing_rows = []
    existing_ids = {str(r.get("location_id")) for r in existing_rows if r.get("location_id")}

state = {}
if STATE_PATH.exists():
    try:
        with open(STATE_PATH, "r", encoding="utf-8") as f:
            state = json.load(f)
    except json.JSONDecodeError:
        state = {}

seen_ids = set(str(x) for x in state.get("seen_attraction_ids", [])) or existing_ids
new_attraction_ids = [aid for aid in attractions_map.keys() if str(aid) not in seen_ids]
new_attractions_map = {aid: attractions_map[aid] for aid in new_attraction_ids}

print("Seen attractions:", len(seen_ids))
print("New attractions this run:", len(new_attractions_map))

rows = []
detail_errors = []
for aid, meta in new_attractions_map.items():
    try:
        d = location_details(aid, language="en", currency="USD")
        row = flatten_details(d)
        row["seed_place"] = meta.get("seed_place")
        row["seed_geo_id"] = meta.get("seed_geo_id")
        rows.append(row)
    except Exception as e:
        detail_errors.append({"location_id": aid, "name": meta.get("name"), "error": str(e)})

# --- MERGE + SAVE ---
new_rows = rows
merged_rows = list(existing_rows)
existing_ids = {str(r.get("location_id")) for r in merged_rows if r.get("location_id")}
for r in new_rows:
    rid = str(r.get("location_id")) if r.get("location_id") is not None else None
    if rid and rid not in existing_ids:
        merged_rows.append(r)
        existing_ids.add(rid)

with open(ATTRACTIONS_PATH, "w", encoding="utf-8") as f:
    json.dump(merged_rows, f, ensure_ascii=False, indent=2)

if detail_errors:
    errors_path = DATA_DIR / "attractions_errors.json"
    with open(errors_path, "w", encoding="utf-8") as f:
        json.dump(detail_errors, f, ensure_ascii=False, indent=2)

all_seen = set(seen_ids)
all_seen.update(str(r.get("location_id")) for r in new_rows if r.get("location_id"))
state = {
    "last_run": datetime.now(timezone.utc).isoformat(),
    "seen_attraction_ids": sorted(all_seen),
}
with open(STATE_PATH, "w", encoding="utf-8") as f:
    json.dump(state, f, ensure_ascii=False, indent=2)

print("Saved attractions.json")
print("New rows:", len(new_rows), "Errors:", len(detail_errors), "Total:", len(merged_rows))
"""
# Imports and environment setup
import os
import time
import json
import boto3
import requests
import pandas as pd
from pathlib import Path
from datetime import datetime, timezone
from supabase import create_client

try:
    from dotenv import load_dotenv
except ImportError as exc:
    raise ImportError(
        "python-dotenv is not installed. Run `pip install python-dotenv` and re-run this cell."
    ) from exc

# Load .env.local or .env from repo root (walk up from current dir)
root_env_path = None
cwd = Path.cwd().resolve()
for parent in [cwd, *cwd.parents]:
    for filename in (".env"):
        candidate = parent / filename
        if candidate.exists():
            root_env_path = candidate
            break
    if root_env_path is not None:
        break

if root_env_path is None:
    raise FileNotFoundError(".env.local or .env not found in current or parent directories.")

load_dotenv(root_env_path)








# S3 Upload
# Export TripAdvisor attractions to JSONL and upload to S3 for ai_processor.pyfrom datetime import datetime

# Inputs
ATTRACTIONS_PATH = Path("attractions.json")  # in this notebook directory
S3_BUCKET = os.getenv("S3_BUCKET_NAME")
S3_PREFIX = "raw_scrapes/"

if not S3_BUCKET:
    raise RuntimeError("Set S3_BUCKET_NAME in your env.")

# Load attractions
with open(ATTRACTIONS_PATH, "r", encoding="utf-8") as f:
    attractions = json.load(f)

# Build JSONL lines compatible with ai_processor
# Each line is treated as an 'article' with content_body.
lines = []
for a in attractions:
    title = a.get("name") or "Unknown Attraction"
    city = a.get("city") or ""
    country = a.get("country") or ""
    address = a.get("address") or ""
    rating = a.get("rating") or ""
    reviews = a.get("num_reviews") or ""
    price = a.get("price_level") or ""
    website = a.get("website") or ""
    seed_place = a.get("seed_place") or ""

    content_body = (
        f"Attraction: {title}\n"
        f"Location: {city}, {country}\n"
        f"Address: {address}\n"
        f"Rating: {rating} (reviews: {reviews})\n"
        f"Price level: {price}\n"
        f"Website: {website}\n"
        f"Seed place: {seed_place}\n"
    ).strip()

    lines.append({
        "source": "TripAdvisor",
        "title": title,
        "url": a.get("web_url") or website or "",
        "content_body": content_body,
        "location_id": a.get("location_id"),
        "seed_place": seed_place,
        "seed_geo_id": a.get("seed_geo_id"),
    })

# Write JSONL locally
stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
jsonl_path = Path(f"ta_attractions_{stamp}.jsonl")
with open(jsonl_path, "w", encoding="utf-8") as f:
    for line in lines:
        f.write(json.dumps(line, ensure_ascii=False) + "\n")

# Upload to S3
s3 = boto3.client("s3")
s3_key = f"{S3_PREFIX}tripadvisor_attractions_{stamp}.jsonl"
s3.upload_file(str(jsonl_path), S3_BUCKET, s3_key)

print("Uploaded:", f"s3://{S3_BUCKET}/{s3_key}")
"""