# Using Gemini, BeautifulSoup, and Selenium

import requests
from bs4 import BeautifulSoup
from urllib.parse import quote_plus, urljoin
import os
import time
import re
import json
import boto3 
from dotenv import load_dotenv
import selenium_scraper # Uses your existing driver factory
import subprocess
import sys
from pathlib import Path
from difflib import SequenceMatcher
from supabase import create_client
from datetime import datetime, timezone, timedelta

# Load environment variables
repo_root = Path(__file__).resolve().parents[2]
load_dotenv(repo_root / ".env")
load_dotenv(repo_root / ".env.local")
load_dotenv()

# Global set to catch repetitive footers/bios across different pages
SEEN_PARAGRAPHS = set()

def get_supabase_client():
    supabase_url = os.getenv("SUPABASE_URL") or os.getenv("NEXT_PUBLIC_SUPABASE_URL")
    supabase_key = (
        os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY")
        or os.getenv("NEXT_PUBLIC_SUPABASE_ANON_KEY")
    )
    if not supabase_url or not supabase_key:
        return None
    return create_client(supabase_url, supabase_key)

def normalize_place_name(name):
    if not name:
        return ""
    cleaned = re.sub(r"[^a-z0-9]+", " ", name.lower()).strip()
    cleaned = re.sub(r"^(the|a|an)\s+", "", cleaned)
    cleaned = re.sub(r"^(st|saint)\s+", "", cleaned)
    return cleaned

def find_existing_place(destination):
    supabase = get_supabase_client()
    if not supabase:
        print("ℹ️ Supabase env vars missing; skipping place lookup.")
        return None

    dest_clean = normalize_place_name(destination)
    if not dest_clean:
        return None

    dest_city = destination.split(",")[0].strip()
    city_query = normalize_place_name(dest_city)
    if not city_query:
        city_query = dest_clean

    try:
        res = supabase.table("place").select(
            "place_id, place_city, place_countryregion, place_stateprovince"
        ).ilike("place_city", f"%{city_query}%").limit(50).execute()
    except Exception as e:
        print(f"⚠️ Supabase lookup failed: {e}")
        return None

    best = None
    best_score = 0.0
    for row in res.data or []:
        row_city = row.get("place_city") or ""
        row_norm = normalize_place_name(row_city)
        if not row_norm:
            continue
        score = SequenceMatcher(None, dest_clean, row_norm).ratio()
        if row_norm in dest_clean or dest_clean in row_norm:
            score = max(score, 0.95)
        if score > best_score:
            best = row
            best_score = score

    if best and best_score >= 0.88:
        best["_match_score"] = round(best_score, 2)
        return best

    return None

def parse_timestamp(value):
    if not value:
        return None
    if isinstance(value, datetime):
        return value
    try:
        cleaned = str(value).strip()
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1] + "+00:00"
        return datetime.fromisoformat(cleaned)
    except Exception:
        return None

def should_refresh_destination(destination):
    existing = find_existing_place(destination)
    if not existing:
        return True

    supabase = get_supabase_client()
    if not supabase:
        return True

    place_id = existing.get("place_id")
    if not place_id:
        return True

    try:
        res = supabase.table("attraction").select(
            "attraction_lastrefreshed"
        ).eq("place_id", place_id).order(
            "attraction_lastrefreshed", desc=True
        ).limit(1).execute()
    except Exception as e:
        print(f"⚠️ Supabase lookup failed: {e}")
        return True

    latest = None
    if res.data:
        latest = parse_timestamp(res.data[0].get("attraction_lastrefreshed"))

    if not latest:
        return True

    now = datetime.now(timezone.utc)
    if latest.tzinfo is None:
        latest = latest.replace(tzinfo=timezone.utc)

    return (now - latest) > timedelta(days=90)

# --- AWS SETUP ---
def get_s3_client():
    """Initializes the S3 client using credentials from .env"""
    try:
        return boto3.client(
            's3',
            aws_access_key_id=os.getenv('AWS_ACCESS_KEY_ID'),
            aws_secret_access_key=os.getenv('AWS_SECRET_ACCESS_KEY')
        )
    except Exception as e:
        print(f"⚠️ AWS Connection Error: {e}")
        return None

def upload_to_s3(local_filepath, destination_name):
    """Uploads the finished JSONL file to the private S3 bucket"""
    s3 = get_s3_client()
    bucket_name = os.getenv('S3_BUCKET_NAME')
    
    if not s3 or not bucket_name:
        print("❌ Skipping S3 Upload: Missing credentials or bucket name.")
        return

    timestamp = time.strftime('%Y-%m-%d')
    file_name = os.path.basename(local_filepath)
    s3_key = f"raw_scrapes/{file_name}" 

    print(f"\n☁️  Uploading to S3 ({bucket_name})...", end=" ")
    
    try:
        s3.upload_file(local_filepath, bucket_name, s3_key)
        print("✅ Success!")
        print(f"   └── Stored as: s3://{bucket_name}/{s3_key}")
    except Exception as e:
        print(f"❌ Failed: {e}")

# --- NEW CLEANING & PROCESSING LOGIC ---

def process_html_content(raw_html):
    """
    1. Extracts comments/reviews and removes them from DOM.
    2. Cleans the remaining DOM (scripts, ads).
    3. Formats the Body text with Markdown headers.
    Returns: (body_text, reviews_text)
    """
    soup = BeautifulSoup(raw_html, 'html.parser')

    # A. EXTRACT REVIEWS (Decomposition)
    # Common selectors for travel blogs and review sites
    comment_selectors = [
        '#comments', '.comments-area', '.comment-list', 
        '#reviews', '.reviews-section', '#respond', 
        '.user-reviews', '.feedback-list',
        '[id*="comment"]', '[class*="comment-body"]'
    ]

    extracted_reviews = []
    for selector in comment_selectors:
        elements = soup.select(selector)
        for el in elements:
            text = el.get_text(separator="\n", strip=True)
            if len(text) > 50: # Filter out empty/tiny divs
                extracted_reviews.append(text)
            # CRITICAL: Remove from soup so it doesn't appear in body
            el.decompose()

    reviews_text = "\n---\n".join(extracted_reviews)

    # B. CLEAN & FORMAT BODY (Your original markdown logic)
    for element in soup(["script", "style", "header", "footer", "nav", "iframe", "noscript", "form", "aside", "button", "input"]):
        element.decompose()

    # Convert Headers to Markdown
    for h in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        level = int(h.name[1])
        h.string = f"\n\n{'#' * level} {h.get_text().strip()}\n"

    # Convert Lists to Bullets
    for li in soup.find_all('li'):
        li.string = f"\n- {li.get_text().strip()}"

    # Extract text and clean whitespace
    text = soup.get_text()
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    
    final_chunks = []
    for chunk in chunks:
        if not chunk: continue
        # Dedup check
        if len(chunk) > 50 and chunk in SEEN_PARAGRAPHS:
            continue
        SEEN_PARAGRAPHS.add(chunk)
        final_chunks.append(chunk)

    body_text = '\n'.join(final_chunks)
    
    return body_text, reviews_text

def refine_text_content(text, title, destination):
    """
    Filters out junk phrases from the BODY text.
    """
    dest_lower = destination.lower()
    title_lower = title.lower()
    
    junk_patterns = [
        r"^home\s*/", r"^menu", r"^search", r"^skip to content",
        r"browse by destination", r"recent posts", r"table of contents",
        r"share\s+tweet", r"click to share", r"pin it",
        r"connect with", r"follow us", r"share this",
        r"copyright", r"all rights reserved", 
        r"affiliate links", r"commission", "sponsored content",
        r"advertisement", r"transparency note",
        r"read more", r"related posts", r"you may also like",
        r"check out this", r"read next",
        r"leave a comment", r"cancel reply", r"post comment",
        r"add a comment", r"reply to", r"posted by",
        r"star this", r"upvote", r"downvote", r"likes?",
        r"react to this", r"login or join",
        r"comments are closed", r"click on a star", 
        r"submit rating", r"submit feedback", 
        r"\d+\s*comments?", r"reply\s*$"
    ]
    junk_regex = re.compile('|'.join(junk_patterns), re.IGNORECASE)

    cleaned_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line: continue
        if junk_regex.search(line): continue
        if len(line) > 300 and line.count('.') < 2: continue 
        cleaned_lines.append(line)

    clean_text = '\n'.join(cleaned_lines)
    
    # Relevance Check
    if dest_lower in title_lower:
        return clean_text

    term_count = clean_text.lower().count(dest_lower)
    if term_count < 3:
        print(f"      🗑️  Skipped irrelevant article (Only {term_count} mentions)")
        return None

    return clean_text

def extract_image_candidates(raw_html, base_url, max_images=8):
    soup = BeautifulSoup(raw_html, 'html.parser')
    candidates = []
    seen = set()

    def add_candidate(url, alt_text):
        if not url:
            return
        url = str(url).strip()
        if not url or url.startswith("data:"):
            return
        if url.startswith("//"):
            url = "https:" + url
        if not url.startswith("http"):
            url = urljoin(base_url, url)
        url_key = url.split("?")[0].strip()
        if not url_key or url_key in seen:
            return
        lower = url_key.lower()
        if any(token in lower for token in ("sprite", "icon", "logo", "avatar", "placeholder", "blank")):
            return
        if lower.endswith(".svg"):
            return
        seen.add(url_key)
        candidates.append({
            "url": url,
            "alt": (alt_text or "").strip()[:200]
        })

    for meta_key in ("og:image", "twitter:image"):
        tag = soup.find("meta", attrs={"property": meta_key}) or soup.find("meta", attrs={"name": meta_key})
        if tag and tag.get("content"):
            add_candidate(tag.get("content"), "")

    for img in soup.find_all("img"):
        src = img.get("src") or img.get("data-src") or img.get("data-lazy-src") or img.get("data-original")
        alt = img.get("alt") or img.get("title") or ""
        add_candidate(src, alt)
        if len(candidates) >= max_images:
            break

    return candidates

def scrape_and_crawl(destination):
    print(f"\n🔎 STARTING SCRAPE FOR: {destination.upper()}\n" + "="*40)
    
    search_term = quote_plus(destination)

    # 1. PHASE 1: SEARCH (Keep this as Requests for speed)
    sites = {
        "Rick Steves": f"https://search.ricksteves.com/?query={search_term}",
        "My Family Travels": f"https://myfamilytravels.com/?s={search_term}",
        "This Rare Earth": f"https://thisrareearth.com/?s={search_term}",
        "My Global Viewpoint": f"https://www.myglobalviewpoint.com/?s={search_term}",
        "Nomadic Matt": f"https://www.nomadicmatt.com/?s={search_term}",
        "The Blonde Abroad": f"https://www.theblondeabroad.com/?s={search_term}"
    }
    
    # Sites that should ONLY use Selenium (skip requests-based scraping)
    selenium_only_sites = {"Reddit"}
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    }

    all_results = []

    for site_name, url in sites.items():
        print(f"🌐 Searching {site_name}...", end=" ")
        site_data = []
        try:
            time.sleep(1)
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                # (Simple selectors for brevity - your original logic was fine here)
                if site_name == "Rick Steves":
                    cards = soup.select("a.search-result")[:5]
                    for card in cards:
                        site_data.append({'Site': site_name, 'Title': card.select_one("h2").get_text(strip=True), 'Link': card.get('href')})
                else:
                    cards = soup.select("article")[:5] or soup.select("div.post")[:5] or soup.select("div.repeater-item")[:5]
                    for card in cards:
                        title = card.select_one("h2 a") or card.select_one("h3 a") or card.select_one("a.page-article__link")
                        if title: site_data.append({'Site': site_name, 'Title': title.get_text(strip=True), 'Link': title['href']})
        except: pass
        
        if not site_data:
            print("Trying Selenium...")
            site_data = selenium_scraper.scrape_links_selenium(site_name, destination)
        else:
            print(f"Found {len(site_data)}")
        
        all_results.extend(site_data)
    
    # Add Reddit (Selenium only)
    print(f"🌐 Searching Reddit...", end=" ")
    reddit_data = selenium_scraper.scrape_links_selenium("Reddit", destination)
    if reddit_data:
        print(f"Found {len(reddit_data)}")
        for item in reddit_data:
            print(f"   - {item.get('Title', 'No Title')[:50]}")
    else:
        print("No results found")
    all_results.extend(reddit_data)


    # 2. PHASE 2: CRAWL (Updated to use Selenium for Reviews)
    if not all_results: return

    # Limit articles for testing (e.g. MAIN_SCRAPER_ARTICLE_LIMIT=1)
    article_limit = int(os.getenv("MAIN_SCRAPER_ARTICLE_LIMIT", "0")) or None
    if article_limit and article_limit > 0:
        all_results = all_results[:article_limit]
        print(f"📋 Limited to {article_limit} article(s) for test run")

    print(f"\n📥 PROCESSING {len(all_results)} PAGES (Using Selenium to capture reviews)...")
    
    # Initialize Driver ONCE
    driver = selenium_scraper.get_driver()
    if not driver:
        print("❌ Critical: Could not initialize Selenium Driver.")
        return

    entries = []
    for i, item in enumerate(all_results, 1):
        url = item['Link']
        print(f"   Processing: {item['Title'][:30]}...", end=" ")
        
        try:
            # Use Selenium instead of Requests
            driver.get(url)
            
            # Scroll to bottom to trigger lazy-loading comments
            driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(2) # Wait for comments to load

            page_source = driver.page_source
            
            # A. SPLIT Body & Reviews
            body_text, reviews_text = process_html_content(page_source)

            image_candidates = extract_image_candidates(page_source, url)
            
            # B. CLEAN Body Text
            final_body = refine_text_content(body_text, item['Title'], destination)
            
            if final_body:
                entry = {
                    "source": item['Site'],
                    "title": item['Title'],
                    "url": url,
                    "type": "web_article",
                    "scraped_at": time.strftime('%Y-%m-%d'),
                    "content_body": final_body,
                    "user_reviews": reviews_text,
                    "has_reviews": bool(reviews_text.strip()),
                    "image_candidates": image_candidates
                }
                entries.append(entry)
                print(f"✅ Processed")
            else:
                print(f"🗑️ Skipped")
                
        except Exception as e:
            print(f"⚠️ Error: {e}")

    driver.quit()
    print(f"\n✅ PROCESSING COMPLETE")
    
    # Upload to S3
    if entries:
        s3 = get_s3_client()
        bucket_name = os.getenv('S3_BUCKET_NAME')
        if s3 and bucket_name:
            stamp = time.strftime('%Y%m%d_%H%M%S')
            file_slug = destination.replace(' ', '_').lower()
            s3_key = f"raw_scrapes/{file_slug}_{stamp}.jsonl"
            payload = "\n".join(json.dumps(entry, ensure_ascii=False) for entry in entries) + "\n"
            print(f"\n☁️  Uploading to S3 ({bucket_name})...", end=" ")
            try:
                s3.put_object(Bucket=bucket_name, Key=s3_key, Body=payload.encode("utf-8"))
                print("✅ Success!")
                print(f"   └── Stored as: s3://{bucket_name}/{s3_key}")
            except Exception as e:
                print(f"❌ Failed: {e}")
        else:
            print("⚠️ Skipping S3 upload: Missing credentials or bucket name.")

def run_tripadvisor_scraper(destination):
    repo_root = Path(__file__).resolve().parents[2]
    ta_path = repo_root / "data" / "TripAdvisor" / "ta_scraper.py"
    if not ta_path.exists():
        print(f"⚠️ TripAdvisor scraper not found at: {ta_path}")
        return
    env = os.environ.copy()
    env["TA_SEED_PLACE"] = destination
    env["TA_SKIP_WEB_SCRAPER"] = "1"
    print(f"\n🧭 Running TripAdvisor scraper for: {destination}")
    subprocess.run([sys.executable, str(ta_path)], env=env, check=False)

def run_ai_processor():
    repo_root = Path(__file__).resolve().parents[2]
    ai_path = repo_root / "ai_database" / "ai_processor.py"
    if not ai_path.exists():
        print(f"⚠️ AI processor not found at: {ai_path}")
        return None
    print(f"\n🤖 Running AI processor...")
    return subprocess.Popen([sys.executable, str(ai_path)])

def run_google_reviews_enrichment():
    repo_root = Path(__file__).resolve().parents[2]
    google_path = repo_root / "data" / "TripAdvisor" / "google_reviews_api.py"
    if not google_path.exists():
        print(f"⚠️ Google reviews script not found at: {google_path}")
        return None
    print(f"\n🧾 Running Google reviews enrichment...")
    return subprocess.Popen([sys.executable, str(google_path)])

def run_post_tripadvisor_processors():
    procs = []

    ai_proc = run_ai_processor()
    if ai_proc is not None:
        procs.append(("AI processor", ai_proc))

    google_proc = run_google_reviews_enrichment()
    if google_proc is not None:
        procs.append(("Google reviews", google_proc))

    if not procs:
        print("⚠️ No post-TripAdvisor processors were started.")
        return

    for label, proc in procs:
        code = proc.wait()
        if code == 0:
            print(f"✅ {label} finished successfully.")
        else:
            print(f"⚠️ {label} exited with code {code}.")

if __name__ == "__main__":
    dest = os.getenv("MAIN_SCRAPER_DESTINATION") or input("Enter destination: ").strip()
    if not dest:
        print("No destination provided")
        sys.exit(1)
    force = os.getenv("MAIN_SCRAPER_FORCE_REFRESH", "").lower() in ("1", "true", "yes")
    if not force and not should_refresh_destination(dest):
        print("Data already exists")
        sys.exit(0)
    scrape_and_crawl(dest)
    if not os.getenv("MAIN_SCRAPER_WEB_ONLY"):
        run_tripadvisor_scraper(dest)
        run_post_tripadvisor_processors()