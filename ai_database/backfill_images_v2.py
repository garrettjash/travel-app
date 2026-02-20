"""
One-time script to backfill images for all attractions in Supabase.
Loops through all places, gets their attractions, and fetches up to 2 images per attraction.
Stores to: {S3_IMG_BUCKET_NAME}/{place_id}/{attraction_id}/image_{n}.ext
"""

import json
import os
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

import boto3
import requests
from dotenv import load_dotenv
from supabase import create_client, Client


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


def download_image(url: str, timeout: int = 10) -> tuple[Optional[bytes], Optional[str]]:
    """Download image from URL."""
    try:
        response = requests.get(url, timeout=timeout, headers={
            'User-Agent': 'Mozilla/5.0'
        })
        if response.status_code == 200:
            content_type = response.headers.get("content-type", "image/jpeg")
            return response.content, content_type
    except Exception as exc:
        pass  # Silently skip failed downloads
    return None, None


def guess_image_extension(url: str, content_type: str) -> str:
    """Guess image extension from URL and content type."""
    type_map = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/gif": ".gif",
        "image/webp": ".webp",
        "image/svg+xml": ".svg"
    }
    if content_type in type_map:
        return type_map[content_type]
    
    path = urlparse(url).path.lower()
    for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"):
        if path.endswith(ext):
            return ext
    
    return ".jpg"


def build_s3_url(bucket: str, region: str, key: str) -> str:
    """Build S3 URL from bucket, region, and key."""
    if region == "us-east-1":
        return f"https://{bucket}.s3.amazonaws.com/{key}"
    return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


def extract_images_from_article(article: dict) -> list[str]:
    """Extract image URLs from article data."""
    urls = []
    
    # Try image_candidates first
    candidates = article.get("image_candidates") or []
    if isinstance(candidates, list):
        for item in candidates:
            if isinstance(item, dict):
                url = item.get("url")
            else:
                url = item
            if isinstance(url, str) and url.startswith("http"):
                urls.append(url)
    
    # Try image_urls
    image_urls = article.get("image_urls") or []
    if isinstance(image_urls, list):
        for url in image_urls:
            if isinstance(url, str) and url.startswith("http") and url not in urls:
                urls.append(url)
    
    return urls


def fetch_articles_for_attractions(supabase: Client, s3_client: any, raw_bucket: str, attraction_ids: list[int]) -> dict[int, list[dict]]:
    """Fetch article data from S3 for given attractions."""
    articles_map: dict[int, list[dict]] = {}
    
    if not attraction_ids:
        return articles_map
    
    # Batch fetch source filenames
    sources_res = supabase.table("attraction_sources").select(
        "attraction_id,attraction_sources_filename"
    ).in_("attraction_id", attraction_ids).execute()
    
    sources = sources_res.data or []
    if not sources:
        return articles_map
    
    # Group by filename to avoid duplicate downloads
    filenames_map: dict[str, list[int]] = {}
    for src in sources:
        filename = src.get("attraction_sources_filename")
        attr_id = src.get("attraction_id")
        if filename and attr_id:
            if filename not in filenames_map:
                filenames_map[filename] = []
            filenames_map[filename].append(attr_id)
    
    # Download and parse each file
    for filename, attr_ids in filenames_map.items():
        try:
            response = s3_client.get_object(Bucket=raw_bucket, Key=f"raw_scrapes/{filename}")
            content = response['Body'].read().decode('utf-8')
            for line in content.strip().split('\n'):
                if line:
                    try:
                        article = json.loads(line)
                        # Associate with all attractions from this source
                        for attr_id in attr_ids:
                            if attr_id not in articles_map:
                                articles_map[attr_id] = []
                            articles_map[attr_id].append(article)
                    except json.JSONDecodeError:
                        pass
        except Exception:
            pass  # Silently skip failed fetches
    
    return articles_map


def backfill_images(
    supabase: Client,
    s3_client: any,
    images_bucket: str,
    raw_data_bucket: str,
    aws_region: str,
    batch_size: int = 100,
    dry_run: bool = False
):
    """Process all places and their attractions to backfill images."""
    
    print(f"📍 Fetching all places from Supabase...")
    
    # Get all places
    offset = 0
    total_places = 0
    total_attractions_processed = 0
    total_images_uploaded = 0
    
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
            
            print(f"\n🌍 Processing place: {place_name} (ID: {place_id})")
            
            # Get all attractions for this place
            attractions_res = supabase.table("attraction").select(
                "attraction_id,attraction_name"
            ).eq("place_id", place_id).execute()
            
            attractions = attractions_res.data or []
            if not attractions:
                print(f"   ⊘ No attractions found")
                continue
            
            print(f"   Found {len(attractions)} attractions")
            
            # Batch fetch articles for all attractions
            attraction_ids = [a.get("attraction_id") for a in attractions if a.get("attraction_id")]
            articles_map = fetch_articles_for_attractions(supabase, s3_client, raw_data_bucket, attraction_ids)
            
            if not articles_map:
                print(f"   ⊘ No article data found")
                continue
            
            # Process each attraction
            for attraction in attractions:
                attr_id = attraction.get("attraction_id")
                attr_name = attraction.get("attraction_name") or "unknown"
                
                # Get image URLs from articles
                articles = articles_map.get(attr_id, [])
                all_image_urls = []
                for article in articles:
                    urls = extract_images_from_article(article)
                    all_image_urls.extend(urls)
                
                if not all_image_urls:
                    continue
                
                # Download and upload max 2 images
                image_count = 0
                for image_url in all_image_urls:
                    if image_count >= 2:  # Max 2 per attraction
                        break
                    
                    content, content_type = download_image(image_url)
                    if not content or not content_type:
                        continue
                    
                    ext = guess_image_extension(image_url, content_type)
                    s3_key = f"{place_id}/{attr_id}/image_{image_count}{ext}"
                    s3_url = build_s3_url(images_bucket, aws_region, s3_key)
                    
                    if not dry_run:
                        try:
                            s3_client.put_object(
                                Bucket=images_bucket,
                                Key=s3_key,
                                Body=content,
                                ContentType=content_type
                            )
                            supabase.table("images").insert({
                                "attraction_id": attr_id,
                                "image_url": s3_url
                            }).execute()
                            print(f"      ✓ {s3_url}")
                            total_images_uploaded += 1
                        except Exception as exc:
                            print(f"      ⚠️  Upload error: {str(exc)[:100]}")
                            continue
                    else:
                        print(f"      [DRY] {s3_url}")
                        total_images_uploaded += 1
                    
                    image_count += 1
                
                if image_count > 0:
                    total_attractions_processed += 1
            
            total_places += 1
        
        offset += batch_size
    
    print(f"\n✅ Done!")
    print(f"   Places processed: {total_places}")
    print(f"   Attractions with images: {total_attractions_processed}")
    print(f"   Total images uploaded: {total_images_uploaded}")


def main():
    load_env()
    
    images_bucket = os.getenv("S3_IMG_BUCKET_NAME")
    raw_data_bucket = os.getenv("S3_BUCKET_NAME")
    aws_region = os.getenv("AWS_DEFAULT_REGION", "us-east-1")
    
    if not images_bucket:
        raise RuntimeError("Missing S3_IMG_BUCKET_NAME in .env")
    if not raw_data_bucket:
        raise RuntimeError("Missing S3_BUCKET_NAME in .env")
    
    print(f"Images bucket: {images_bucket}")
    print(f"Raw data bucket: {raw_data_bucket}")
    
    supabase, s3 = get_clients()
    backfill_images(supabase, s3, images_bucket, raw_data_bucket, aws_region, dry_run=False)


if __name__ == "__main__":
    main()
