import os
import re
import time
import requests
from bs4 import BeautifulSoup
import tldextract

# Direct site search endpoints
SITE_SEARCHES = {
    "reddit.com": "https://www.reddit.com/search/?q={query}+travel",
    "tripadvisor.com": "https://www.tripadvisor.com/Search?q={query}",
}

ALLOWED_DOMAINS = {"reddit.com", "tripadvisor.com", "lonelyplanet.com", "fodors.com", "routard.com", "travel.stackexchange.com"}

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
}

def search_links(query: str, max_results: int = 8):
    """Search multiple travel sites directly for the query."""
    links = []
    
    # Search Reddit
    try:
        url = SITE_SEARCHES["reddit.com"].format(query=query.replace(" ", "+"))
        r = requests.get(url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        # Reddit search results are in <a> tags with href="/r/... or /user/... patterns
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if href.startswith("/r/") or href.startswith("https://reddit.com"):
                full_url = href if href.startswith("http") else f"https://reddit.com{href}"
                if full_url not in links:
                    links.append(full_url)
                    print(f"DEBUG: Added Reddit link: {full_url[:60]}")
                if len(links) >= max_results:
                    break
    except Exception as e:
        print(f"Reddit search error: {e}")
    
    # Search TripAdvisor
    try:
        url = SITE_SEARCHES["tripadvisor.com"].format(query=query.replace(" ", "+"))
        r = requests.get(url, headers=HEADERS, timeout=10)
        r.raise_for_status()
        soup = BeautifulSoup(r.text, "html.parser")
        for a in soup.find_all("a", href=True):
            href = a.get("href", "")
            if "tripadvisor.com" in href:
                if href not in links:
                    links.append(href)
                    print(f"DEBUG: Added TripAdvisor link: {href[:60]}")
                if len(links) >= max_results:
                    break
    except Exception as e:
        print(f"TripAdvisor search error: {e}")
    
    print(f"DEBUG: Returning {len(links)} links")
    return links

def fetch_text(url: str) -> str:
    r = requests.get(url, headers=HEADERS, timeout=15)
    r.raise_for_status()
    soup = BeautifulSoup(r.text, "html.parser")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    text = soup.get_text(separator="\n")
    text = re.sub(r"\n\s*\n+", "\n\n", text)
    return text.strip()

def save_output(destination: str, content: str):
    os.makedirs("../output", exist_ok=True)
    fname = f"../output/{destination.replace(' ', '_').lower()}_{int(time.time())}.txt"
    with open(fname, "w", encoding="utf-8") as f:
        f.write(content)
    return fname

def scrape_destination(destination: str):
    query = f"{destination} travel tips recommendations reddit tripadvisor"
    links = search_links(query)
    print(f"Found {len(links)} links")
    collected = []
    for url in links:
        try:
            print(f"Fetching {url}")
            text = fetch_text(url)
            collected.append(f"URL: {url}\n\n{text}\n\n{'-'*80}\n")
            time.sleep(1)
        except Exception as e:
            print(f"Skip {url}: {e}")
    if not collected:
        print("No content collected.")
        return None
    combined = "\n".join(collected)
    return save_output(destination, combined)

if __name__ == "__main__":
    dest = input("Enter a travel destination: ").strip()
    if dest:
        path = scrape_destination(dest)
        if path:
            print(f"Saved to {path}")
