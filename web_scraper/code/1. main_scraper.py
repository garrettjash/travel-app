# Using Gemini and BeautifulSoup

import requests
from bs4 import BeautifulSoup
from urllib.parse import quote_plus
import os
import time
import re
import json # Added for structured output
import selenium_scraper

# Global set to catch repetitive footers/bios across different pages
SEEN_PARAGRAPHS = set()

def clean_html_to_markdown(raw_html):
    """
    Converts HTML to Markdown-ish text to preserve hierarchy for the AI.
    """
    soup = BeautifulSoup(raw_html, 'html.parser')
    
    # 1. Remove standard junk
    for element in soup(["script", "style", "header", "footer", "nav", "iframe", "noscript", "form", "aside", "button", "input"]):
        element.decompose()

    # 2. Convert Headers to Markdown (Helps AI understand sections)
    for h in soup.find_all(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']):
        # e.g., <h2>Title</h2> -> ## Title
        level = int(h.name[1])
        h.string = f"\n\n{'#' * level} {h.get_text().strip()}\n"

    # 3. Convert Lists to Bullets (Helps AI read features/pros/cons)
    for li in soup.find_all('li'):
        li.string = f"\n- {li.get_text().strip()}"

    # 4. Get text
    text = soup.get_text()

    # 5. Clean up whitespace
    lines = (line.strip() for line in text.splitlines())
    chunks = (phrase.strip() for line in lines for phrase in line.split("  "))
    
    # --- GLOBAL DEDUPLICATION ---
    final_chunks = []
    for chunk in chunks:
        if not chunk: continue
        
        # If this exact sentence/paragraph has appeared in a previous article, skip it.
        # This kills repetitive "About the Author" or "Sign up" sections perfectly.
        if len(chunk) > 50 and chunk in SEEN_PARAGRAPHS:
            continue
            
        SEEN_PARAGRAPHS.add(chunk)
        final_chunks.append(chunk)

    return '\n'.join(final_chunks)

def refine_text_content(text, title, destination):
    """
    Cleans text and applies a 'Relevance Threshold' to remove articles
    that only mention the destination tangentially.
    """
    dest_lower = destination.lower()
    title_lower = title.lower()
    
    # 1. EXPANDED JUNK PATTERNS (Interactive elements & UI noise)
    junk_patterns = [
        # Navigation & Structure
        r"^home\s*/", r"^menu", r"^search", r"^skip to content",
        r"browse by destination", r"recent posts", r"table of contents",
        
        # Social Media & Sharing
        r"share\s+tweet", r"click to share", r"pin it",
        r"connect with", r"follow us", r"share this",
        
        # Legal & Ads
        r"copyright", r"all rights reserved", 
        r"affiliate links", r"commission", "sponsored content",
        r"advertisement", r"transparency note",
        
        # Blog Fluff
        r"read more", r"related posts", r"you may also like",
        r"check out this", r"read next",
        
        # Interactive / Comments / Upvotes
        r"leave a comment", r"cancel reply", r"post comment",
        r"add a comment", r"reply to", r"posted by",
        r"star this", r"upvote", r"downvote", r"likes?",
        r"react to this", r"login or join",
        r"comments are closed", r"click on a star", 
        r"submit rating", r"submit feedback", 
        r"\d+\s*comments?", # e.g. "42 Comments"
        r"reply\s*$"       # Lines that just say "Reply"
    ]
    junk_regex = re.compile('|'.join(junk_patterns), re.IGNORECASE)

    # 2. LINE-BY-LINE CLEANING
    cleaned_lines = []
    for line in text.splitlines():
        line = line.strip()
        if not line: continue
        
        # Regex Filter
        if junk_regex.search(line): continue
        
        # Tag Cloud Filter (Long lines with no periods are usually menus)
        if len(line) > 300 and line.count('.') < 2: continue 
        
        cleaned_lines.append(line)

    clean_text = '\n'.join(cleaned_lines)

    # 3. RELEVANCE FILTERING (The "Istanbul" Fix)
    
    # CASE A: Destination is in the Title
    # Trust the article. Return the whole text (minus junk).
    if dest_lower in title_lower:
        return clean_text

    # CASE B: Destination is NOT in the Title
    # We need to be suspicious. Count how many times the destination appears.
    term_count = clean_text.lower().count(dest_lower)
    
    # If mentioned fewer than 3 times, it's irrelevant context. Kill it.
    if term_count < 3:
        print(f"      🗑️  Skipped irrelevant article (Only {term_count} mentions)")
        return None

    # CASE C: Listicle Filtering (Title doesn't match, but mentions > 3)
    # This handles "13 Largest Airports" -> Keep only the Shanghai paragraphs.
    print(f"      ✂️  'Listicle' mode: Filtering irrelevant blocks...")
    
    final_blocks = []
    # Split by double newline to preserve paragraph structure
    blocks = clean_text.split('\n\n')
    
    for block in blocks:
        # Keep block if it mentions destination OR is a Section Header (#)
        if dest_lower in block.lower() or block.strip().startswith('#'):
            final_blocks.append(block)
    
    clean_text = '\n\n'.join(final_blocks)
    
    # Final sanity check: If filtering left us with nothing, return None
    if not clean_text.strip():
        return None

    return clean_text

def scrape_and_crawl(destination):
    print(f"\n🔎 STARTING SCRAPE FOR: {destination.upper()}\n" + "="*40)
    
    search_term = quote_plus(destination)
    current_dir = os.path.dirname(os.path.abspath(__file__))
    output_dir = os.path.join(current_dir, "..", "output")
    os.makedirs(output_dir, exist_ok=True)
    
    # CHANGED: Using .jsonl (JSON Lines) for structured data
    output_filename = f"{destination.replace(' ', '_').lower()}_data.jsonl"
    output_filepath = os.path.join(output_dir, output_filename)

    # ... [Keep your existing Site Configuration & Headers] ...
    # (Sites dictionary and headers go here)
    sites = {
        "Rick Steves": f"https://search.ricksteves.com/?query={search_term}",
        "My Family Travels": f"https://myfamilytravels.com/?s={search_term}",
        "This Rare Earth": f"https://thisrareearth.com/?s={search_term}",
        "My Global Viewpoint": f"https://www.myglobalviewpoint.com/?s={search_term}"
    }
    
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.5'
    }

    all_results = []

    # ... [Keep your existing PHASE 1: Search logic] ...
    # (Use the code you already have for searching Rick Steves, MyFamilyTravels, etc.)
    # (Including the Selenium fallback)
    # ...
    
    # 3. PHASE 1: Search (Abbreviated for brevity - paste your loop here)
    for site_name, url in sites.items():
        print(f"🌐 Searching {site_name}...", end=" ")
        site_data = []
        try:
            time.sleep(1)
            response = requests.get(url, headers=headers, timeout=10)
            if response.status_code == 200:
                soup = BeautifulSoup(response.text, 'html.parser')
                # ... (Your existing selectors) ...
                if site_name == "Rick Steves":
                    cards = soup.select("a.search-result")[:5]
                    for card in cards:
                        site_data.append({'Site': site_name, 'Title': card.select_one("h2").get_text(strip=True), 'Link': card.get('href')})
                elif site_name == "My Family Travels":
                    cards = soup.select("div.repeater-item")[:5]
                    for card in cards:
                        site_data.append({'Site': site_name, 'Title': card.select_one("span.txt-title").get_text(strip=True), 'Link': card.select_one("a.page-article__link")['href']})
                else:
                    cards = soup.select("article")[:5] or soup.select("div.post")[:5]
                    for card in cards:
                        title = card.select_one("h2 a") or card.select_one("h3 a")
                        if title: site_data.append({'Site': site_name, 'Title': title.get_text(strip=True), 'Link': title['href']})
        except: pass
        
        if not site_data:
            print("Trying Selenium...")
            site_data = selenium_scraper.scrape_links_selenium(site_name, destination)
        else:
            print(f"Found {len(site_data)}")
        
        all_results.extend(site_data)


    # 4. PHASE 2: Crawl & Save as JSONL
    if not all_results: return

    print(f"\n📥 PROCESSING {len(all_results)} PAGES...")
    
    # Open file in 'append' mode so we can add to it later
    with open(output_filepath, "w", encoding="utf-8") as f:
        for i, item in enumerate(all_results, 1):
            url = item['Link']
            print(f"   Processing: {item['Title'][:30]}...", end=" ")
            
            try:
                time.sleep(1.5)
                page_response = requests.get(url, headers=headers, timeout=15)
                
                if page_response.status_code == 200:
                    # 1. Markdown Clean
                    markdown_text = clean_html_to_markdown(page_response.text)
                    
                    # 2. Semantic Clean
                    final_text = refine_text_content(markdown_text, item['Title'], destination) # pass a title as well to make this more context-aware
                    
                    if final_text:
                        # 3. Create Structured Object
                        entry = {
                            "source": item['Site'],
                            "title": item['Title'],
                            "url": url,
                            "type": "web_article",
                            "content": final_text,
                            "scraped_at": time.strftime('%Y-%m-%d')
                        }
                        
                        # Write one JSON object per line
                        f.write(json.dumps(entry, ensure_ascii=False) + "\n")
                        print(f"✅ Saved")
                    else:
                        print(f"🗑️ Skipped")
                else:
                    print(f"⚠️ HTTP {page_response.status_code}")
                    
            except Exception as e:
                print(f"⚠️ Error: {e}")

    print(f"\n✅ DATA SAVED: {output_filepath}")

if __name__ == "__main__":
    dest = input("Enter destination: ")
    scrape_and_crawl(dest)