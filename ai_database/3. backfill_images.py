import argparse
import mimetypes
import os
import re
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import quote, urlparse

import boto3
import requests
from dotenv import load_dotenv
from supabase import Client, create_client


WIKIPEDIA_SEARCH_URL = "https://en.wikipedia.org/w/api.php"
WIKIPEDIA_SUMMARY_URL = "https://en.wikipedia.org/api/rest_v1/page/summary/{title}"
WIKIMEDIA_COMMONS_SEARCH_URL = "https://commons.wikimedia.org/w/api.php"
GOOGLE_TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
GOOGLE_PHOTO_URL = "https://maps.googleapis.com/maps/api/place/photo"
REQUEST_HEADERS = {"User-Agent": "travel-app-image-backfill/1.0"}


def load_env() -> None:
	repo_root = Path(__file__).resolve().parents[1]
	load_dotenv(repo_root / ".env.local")
	load_dotenv(repo_root / ".env")


def get_clients() -> tuple[Client, Any]:
	supabase_url = os.getenv("SUPABASE_URL")
	supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
	aws_region = os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"

	if not supabase_url or not supabase_key:
		raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")

	s3 = boto3.client(
		"s3",
		region_name=aws_region,
		aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
		aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
	)

	return create_client(supabase_url, supabase_key), s3


def guess_image_extension(content_type: str, fallback_url: Optional[str] = None) -> str:
	guessed = mimetypes.guess_extension(content_type or "")
	if guessed:
		if guessed == ".jpe":
			return ".jpg"
		return guessed

	if fallback_url:
		path = urlparse(fallback_url).path.lower()
		for ext in (".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg"):
			if path.endswith(ext):
				return ext

	return ".jpg"


def build_s3_url(bucket: str, region: str, key: str) -> str:
	if region == "us-east-1":
		return f"https://{bucket}.s3.amazonaws.com/{key}"
	return f"https://{bucket}.s3.{region}.amazonaws.com/{key}"


def fetch_attractions(supabase: Client, place_filter: Optional[str], limit: Optional[int]) -> list[dict[str, Any]]:
	offset = 0
	batch = 300
	rows: list[dict[str, Any]] = []

	while True:
		query = supabase.table("attraction").select(
			"attraction_id,place_id,attraction_name,attraction_city,attraction_countryregion,attraction_rawdata"
		)

		if place_filter:
			query = query.ilike("attraction_city", place_filter)

		res = query.range(offset, offset + batch - 1).execute()
		chunk = res.data or []
		if not chunk:
			break

		rows.extend(chunk)
		if limit is not None and len(rows) >= limit:
			return rows[:limit]

		if place_filter:
			break
		offset += batch

	return rows


def find_existing_image_ids(supabase: Client, attraction_ids: list[int]) -> set[int]:
	if not attraction_ids:
		return set()

	existing: set[int] = set()
	chunk_size = 500
	for i in range(0, len(attraction_ids), chunk_size):
		chunk = attraction_ids[i : i + chunk_size]
		try:
			res = supabase.table("images").select("attraction_id").in_("attraction_id", chunk).execute()
			for row in res.data or []:
				attraction_id = row.get("attraction_id")
				if attraction_id is not None:
					existing.add(int(attraction_id))
		except Exception:
			continue

	return existing


def download_image(url: str, timeout: int = 20) -> tuple[Optional[bytes], Optional[str]]:
	try:
		resp = requests.get(
			url,
			timeout=timeout,
			headers=REQUEST_HEADERS,
			allow_redirects=True,
		)
		if resp.status_code != 200:
			return None, None
		content_type = resp.headers.get("content-type", "")
		if not content_type.startswith("image/"):
			return None, None
		if len(resp.content or b"") < 15_000:
			return None, None
		return resp.content, content_type
	except Exception:
		return None, None


def normalize_alias_name(name: str) -> list[str]:
	base = str(name or "").strip()
	if not base:
		return []

	variants = [base]
	no_parens = re.sub(r"\s*\([^)]*\)", "", base).strip()
	if no_parens and no_parens not in variants:
		variants.append(no_parens)

	replaced = no_parens.replace("&", " and ")
	replaced = re.sub(r"\s+", " ", replaced).strip()
	if replaced and replaced not in variants:
		variants.append(replaced)

	# Common attraction aliases/abbreviations
	alias_map = {
		r"\bv\s*&\s*a\b": "victoria and alfred",
		r"\bmocaa\b": "museum of contemporary art africa",
		r"\bctr\b": "centre",
	}
	for pattern, repl in alias_map.items():
		candidate = re.sub(pattern, repl, replaced, flags=re.IGNORECASE).strip()
		candidate = re.sub(r"\s+", " ", candidate)
		if candidate and candidate not in variants:
			variants.append(candidate)

	return variants[:6]


def build_query_candidates(attraction_name: str, city: Optional[str], country: Optional[str]) -> list[str]:
	city = (city or "").strip()
	country = (country or "").strip()
	names = normalize_alias_name(attraction_name)
	queries: list[str] = []

	for name in names:
		for q in [
			name,
			f"{name}, {city}" if city else "",
			f"{name}, {city}, {country}" if city and country else "",
			f"{name} ({city})" if city else "",
		]:
			clean = re.sub(r"\s+", " ", q).strip(" ,")
			if clean and clean not in queries:
				queries.append(clean)

	return queries[:12]


def wiki_search_page_titles(query: str, limit: int = 5) -> list[str]:
	params = {
		"action": "query",
		"list": "search",
		"srsearch": query,
		"srlimit": max(1, min(limit, 10)),
		"format": "json",
	}
	try:
		resp = requests.get(WIKIPEDIA_SEARCH_URL, params=params, timeout=20, headers=REQUEST_HEADERS)
		if resp.status_code != 200:
			return []
		rows = ((resp.json() or {}).get("query") or {}).get("search") or []
		return [str(r.get("title")).strip() for r in rows if r.get("title")]
	except Exception:
		return []


def wiki_summary_thumbnail(title: str) -> Optional[str]:
	if not title:
		return None
	url = WIKIPEDIA_SUMMARY_URL.format(title=quote(title.replace(" ", "_")))
	try:
		resp = requests.get(url, timeout=20, headers=REQUEST_HEADERS)
		if resp.status_code != 200:
			return None
		body = resp.json() or {}
		thumb = body.get("originalimage") or body.get("thumbnail") or {}
		src = thumb.get("source") if isinstance(thumb, dict) else None
		if isinstance(src, str) and src.startswith("http"):
			return src
		return None
	except Exception:
		return None


def wiki_page_images(title: str) -> tuple[list[str], list[str]]:
	if not title:
		return [], []

	params = {
		"action": "query",
		"titles": title,
		"redirects": 1,
		"prop": "pageimages|pageprops|links",
		"piprop": "thumbnail|original",
		"pithumbsize": 1600,
		"pllimit": 20,
		"format": "json",
	}
	try:
		resp = requests.get(WIKIPEDIA_SEARCH_URL, params=params, timeout=20, headers=REQUEST_HEADERS)
		if resp.status_code != 200:
			return [], []
		pages = ((resp.json() or {}).get("query") or {}).get("pages") or {}
		if not pages:
			return [], []

		for page in pages.values():
			props = page.get("pageprops") or {}
			if props.get("disambiguation") is not None:
				links = page.get("links") or []
				titles = [str(l.get("title")).strip() for l in links if l.get("title")]
				return [], titles[:10]

			images: list[str] = []
			original = page.get("original") or {}
			thumbnail = page.get("thumbnail") or {}
			for candidate in [original.get("source"), thumbnail.get("source")]:
				if isinstance(candidate, str) and candidate.startswith("http") and candidate not in images:
					images.append(candidate)
			return images, []

		return [], []
	except Exception:
		return [], []


def wikimedia_commons_image(query: str) -> Optional[str]:
	params = {
		"action": "query",
		"generator": "search",
		"gsrsearch": f"{query} filetype:bitmap",
		"gsrnamespace": 6,
		"gsrlimit": 3,
		"prop": "imageinfo",
		"iiprop": "url|mime",
		"format": "json",
	}
	try:
		resp = requests.get(WIKIMEDIA_COMMONS_SEARCH_URL, params=params, timeout=20, headers=REQUEST_HEADERS)
		if resp.status_code != 200:
			return None
		pages = ((resp.json() or {}).get("query") or {}).get("pages") or {}
		for page in pages.values():
			infos = page.get("imageinfo") or []
			if not infos:
				continue
			first = infos[0]
			url = first.get("url")
			mime = first.get("mime") or ""
			if isinstance(url, str) and url.startswith("http") and str(mime).startswith("image/"):
				return url
		return None
	except Exception:
		return None


def google_photo_bytes(query: str, api_key: str) -> tuple[Optional[bytes], Optional[str], Optional[str]]:
	if not api_key:
		return None, None, None
	try:
		search = requests.get(
			GOOGLE_TEXT_SEARCH_URL,
			params={"query": query, "key": api_key},
			timeout=20,
		)
		if search.status_code != 200:
			return None, None, None
		results = (search.json() or {}).get("results") or []
		if not results:
			return None, None, None
		photos = results[0].get("photos") or []
		if not photos:
			return None, None, None
		photo_ref = photos[0].get("photo_reference")
		if not photo_ref:
			return None, None, None

		max_width = 800
		try:
			configured = int(os.getenv("GOOGLE_IMAGE_MAX_WIDTH", "800"))
			if configured >= 320:
				max_width = configured
		except Exception:
			pass

		photo = requests.get(
			GOOGLE_PHOTO_URL,
			params={"maxwidth": max_width, "photo_reference": photo_ref, "key": api_key},
			timeout=25,
			allow_redirects=True,
		)
		if photo.status_code != 200:
			return None, None, None
		content_type = photo.headers.get("content-type", "")
		if not content_type.startswith("image/"):
			return None, None, None
		return photo.content, content_type, "google_places"
	except Exception:
		return None, None, None


def first_non_google_image(attraction_name: str, city: Optional[str], country: Optional[str]) -> tuple[Optional[bytes], Optional[str], Optional[str]]:
	queries = build_query_candidates(attraction_name, city, country)
	seen_titles: set[str] = set()

	# 1) Wikipedia via multiple search candidates + pageimages + disambiguation links
	for query in queries:
		for title in wiki_search_page_titles(query, limit=5):
			norm = title.lower().strip()
			if not norm or norm in seen_titles:
				continue
			seen_titles.add(norm)

			# summary thumbnail (fast path)
			thumb_url = wiki_summary_thumbnail(title)
			if thumb_url:
				img, ctype = download_image(thumb_url)
				if img and ctype:
					return img, ctype, "wikipedia_summary"

			# pageimages (handles redirects) + disambiguation exploration
			page_images, disambig_titles = wiki_page_images(title)
			for image_url in page_images:
				img, ctype = download_image(image_url)
				if img and ctype:
					return img, ctype, "wikipedia_pageimages"

			for dis_title in disambig_titles[:6]:
				dis_images, _ = wiki_page_images(dis_title)
				for image_url in dis_images:
					img, ctype = download_image(image_url)
					if img and ctype:
						return img, ctype, "wikipedia_disambiguation"

	# 2) Wikimedia Commons search fallback with same query candidates
	for query in queries:
		commons_url = wikimedia_commons_image(query)
		if commons_url:
			img, ctype = download_image(commons_url)
			if img and ctype:
				return img, ctype, "wikimedia_commons"

	return None, None, None


def backfill_images(
	supabase: Client,
	s3_client: Any,
	images_bucket: str,
	aws_region: str,
	place_filter: Optional[str],
	limit: Optional[int],
	dry_run: bool,
	allow_google_fallback: bool,
) -> None:
	google_maps_key = os.getenv("GOOGLE_MAPS_API_KEY") if allow_google_fallback else None

	attractions = fetch_attractions(supabase, place_filter=place_filter, limit=limit)
	if not attractions:
		print("No attractions found.")
		return

	attr_ids = [int(a.get("attraction_id")) for a in attractions if a.get("attraction_id") is not None]
	existing_image_ids = find_existing_image_ids(supabase, attr_ids)

	print(f"Found {len(attractions)} attraction(s)")
	print(f"Already with image: {len(existing_image_ids)}")
	print(f"Need image backfill: {len(attractions) - len(existing_image_ids)}")
	print(f"Google fallback enabled: {bool(google_maps_key)}")

	uploaded = 0
	skipped_existing = 0
	skipped_not_found = 0
	errors = 0

	for row in attractions:
		attraction_id = row.get("attraction_id")
		if attraction_id is None:
			continue
		attraction_id = int(attraction_id)

		name = (row.get("attraction_name") or "").strip()
		city = (row.get("attraction_city") or "").strip() or None
		country = (row.get("attraction_countryregion") or "").strip() or None
		place_id = row.get("place_id")
		if not name or place_id is None:
			continue

		if attraction_id in existing_image_ids:
			skipped_existing += 1
			continue

		try:
			img_bytes, content_type, source = first_non_google_image(name, city, country)
			if not img_bytes or not content_type:
				if google_maps_key:
					query = ", ".join([p for p in [name, city or "", country or ""] if p])
					img_bytes, content_type, source = google_photo_bytes(query, google_maps_key)

			if not img_bytes or not content_type:
				skipped_not_found += 1
				print(f"   ⊘ No image found: {name}")
				continue

			ext = guess_image_extension(content_type)
			s3_key = f"{place_id}/{attraction_id}/image_0{ext}"
			image_url = build_s3_url(images_bucket, aws_region, s3_key)

			if dry_run:
				print(f"   [DRY] Would upload {name} from {source}: {image_url}")
				uploaded += 1
				continue

			s3_client.put_object(
				Bucket=images_bucket,
				Key=s3_key,
				Body=img_bytes,
				ContentType=content_type,
			)
			supabase.table("images").insert({"attraction_id": attraction_id, "image_url": image_url}).execute()
			uploaded += 1
			print(f"   ✓ Uploaded {name} from {source}: {image_url}")

			# Keep light politeness delay for Wikimedia/Wikipedia APIs
			time.sleep(0.2)
		except Exception as exc:
			errors += 1
			print(f"   ⚠️ Failed {name}: {exc}")

	print("\n✅ Image backfill complete")
	print(f"   Uploaded: {uploaded}")
	print(f"   Skipped (already had image): {skipped_existing}")
	print(f"   Skipped (no image found): {skipped_not_found}")
	print(f"   Errors: {errors}")
	final_existing_image_ids = find_existing_image_ids(supabase, attr_ids)
	final_missing_count = len(attractions) - len(final_existing_image_ids)
	print(f"   FINAL COUNT (still needs image): {final_missing_count}")


def main() -> None:
	parser = argparse.ArgumentParser(description="Backfill attraction images while minimizing Google API usage")
	parser.add_argument("--place", type=str, default=None, help="Filter by attraction city (ILIKE), e.g. 'Shanghai'")
	parser.add_argument("--limit", type=int, default=None, help="Max number of attractions to scan")
	parser.add_argument("--dry-run", action="store_true", help="Preview actions without uploading/inserting")
	parser.add_argument(
		"--allow-google-fallback",
		action="store_true",
		help="If set, use Google Places Photo only when Wikimedia/Wikipedia fail",
	)
	args = parser.parse_args()

	load_env()
	images_bucket = os.getenv("S3_IMG_BUCKET_NAME")
	aws_region = os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"
	if not images_bucket:
		raise RuntimeError("Missing S3_IMG_BUCKET_NAME")

	supabase, s3_client = get_clients()
	backfill_images(
		supabase=supabase,
		s3_client=s3_client,
		images_bucket=images_bucket,
		aws_region=aws_region,
		place_filter=args.place,
		limit=args.limit,
		dry_run=args.dry_run,
		allow_google_fallback=args.allow_google_fallback,
	)


if __name__ == "__main__":
	main()
