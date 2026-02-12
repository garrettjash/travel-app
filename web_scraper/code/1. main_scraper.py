# Using Gemini, BeautifulSoup, and Selenium

import requests
from bs4 import BeautifulSoup
from urllib.parse import quote_plus
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

# Load environment variables
load_dotenv()

# Global set to catch repetitive footers/bios across different pages
SEEN_PARAGRAPHS = set()

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

def scrape_and_crawl(destination):
    print(f"\n🔎 STARTING SCRAPE FOR: {destination.upper()}\n" + "="*40)
    
    search_term = quote_plus(destination)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(current_dir, "..", "output")
    os.makedirs(output_dir, exist_ok=True)
    
    output_filename = f"{destination.replace(' ', '_').lower()}_data.jsonl"
    output_filepath = os.path.join(output_dir, output_filename)

    # 1. PHASE 1: SEARCH (Keep this as Requests for speed)
    sites = {
        "Rick Steves": f"https://search.ricksteves.com/?query={search_term}",
        "My Family Travels": f"https://myfamilytravels.com/?s={search_term}",
        "This Rare Earth": f"https://thisrareearth.com/?s={search_term}",
        "My Global Viewpoint": f"https://www.myglobalviewpoint.com/?s={search_term}",
        "Nomadic Matt": f"https://www.nomadicmatt.com/?s={search_term}",
        "The Blonde Abroad": f"https://www.theblondeabroad.com/?s={search_term}"
    }
    
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


    # 2. PHASE 2: CRAWL (Updated to use Selenium for Reviews)
    if not all_results: return

    print(f"\n📥 PROCESSING {len(all_results)} PAGES (Using Selenium to capture reviews)...")
    
    # Initialize Driver ONCE
    driver = selenium_scraper.get_driver()
    if not driver:
        print("❌ Critical: Could not initialize Selenium Driver.")
        return

    with open(output_filepath, "w", encoding="utf-8") as f:
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
                
                # B. CLEAN Body Text
                final_body = refine_text_content(body_text, item['Title'], destination)
                
                if final_body:
                    entry = {
                        "source": item['Site'],
                        "title": item['Title'],
                        "url": url,
                        "type": "web_article",
                        "scraped_at": time.strftime('%Y-%m-%d'),
                        # NEW DATA STRUCTURE
                        "content_body": final_body,    # The Clean Facts
                        "user_reviews": reviews_text,  # The Raw Sentiment
                        "has_reviews": bool(reviews_text.strip())
                    }
                    f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                    print(f"✅ Saved")
                else:
                    print(f"🗑️ Skipped")
                    
            except Exception as e:
                print(f"⚠️ Error: {e}")

    driver.quit()
    print(f"\n✅ DATA SAVED LOCALLY: {output_filepath}")
    
    # 3. PHASE 3: Upload to S3
    upload_to_s3(output_filepath, destination)

def run_tripadvisor_scraper(destination):
    repo_root = Path(__file__).resolve().parents[2]
    ta_path = repo_root / "data" / "TripAdvisor" / "ta_scraper.py"
    if not ta_path.exists():
        print(f"⚠️ TripAdvisor scraper not found at: {ta_path}")
        return
    env = os.environ.copy()
    env["TA_SEED_PLACE"] = destination
    print(f"\n🧭 Running TripAdvisor scraper for: {destination}")
    subprocess.run([sys.executable, str(ta_path)], env=env, check=False)

if __name__ == "__main__":
    dest = input("Enter destination: ")
    scrape_and_crawl(dest)
    run_tripadvisor_scraper(dest)