import argparse
import datetime
import importlib.util
import json
import math
import mimetypes
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Optional
from urllib.parse import urlparse

import boto3
import requests
from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field
from supabase import Client, create_client


TEXT_SEARCH_URL = "https://maps.googleapis.com/maps/api/place/textsearch/json"
DETAILS_URL = "https://maps.googleapis.com/maps/api/place/details/json"
PHOTO_URL = "https://maps.googleapis.com/maps/api/place/photo"


class ParsedPlace(BaseModel):
	city: str
	country: Optional[str] = None


class AttractionCandidate(BaseModel):
	name: str = Field(..., description="Attraction name")
	city: str = Field(..., description="City where attraction is located")
	category: str = Field(..., description="Category like Museum, Landmark, Theme Park")
	short_summary: str = Field(..., description="One concise summary sentence")
	popularity_keywords: list[str] = Field(default_factory=list)
	estimated_price_level: str = Field(default="Unknown")
	why_popular: str = Field(default="")
	recommended_visit_minutes: Optional[int] = None


class PlaceAttractionPlan(BaseModel):
	attractions: list[AttractionCandidate]


NEXT_CANONICAL_ID: Optional[int] = None
GOOGLE_REVIEWS_MODULE = None
GOOGLE_REVIEWS_MODULE_LOADED = False
GOOGLE_MODULE_LOCK = threading.Lock()


def load_env() -> None:
	repo_root = Path(__file__).resolve().parents[1]
	load_dotenv(repo_root / ".env.local")
	load_dotenv(repo_root / ".env")


def normalize_name(name: str) -> str:
	cleaned = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
	cleaned = re.sub(r"^(the|a|an)\s+", "", cleaned)
	return cleaned


def get_clients() -> tuple[Client, OpenAI, Any]:
	supabase_url = os.getenv("SUPABASE_URL")
	supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
	openai_key = os.getenv("OPENAI_API_KEY")
	aws_region = os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"

	if not supabase_url or not supabase_key:
		raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
	if not openai_key:
		raise RuntimeError("Missing OPENAI_API_KEY")

	s3 = boto3.client(
		"s3",
		region_name=aws_region,
		aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
		aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
	)
	return create_client(supabase_url, supabase_key), OpenAI(api_key=openai_key), s3


def load_google_reviews_module():
	global GOOGLE_REVIEWS_MODULE
	global GOOGLE_REVIEWS_MODULE_LOADED

	with GOOGLE_MODULE_LOCK:
		if GOOGLE_REVIEWS_MODULE_LOADED:
			return GOOGLE_REVIEWS_MODULE

		repo_root = Path(__file__).resolve().parents[1]
		module_path = repo_root / "data" / "TripAdvisor" / "google_reviews_api.py"
		GOOGLE_REVIEWS_MODULE_LOADED = True

		if not module_path.exists():
			return None

		try:
			spec = importlib.util.spec_from_file_location("google_reviews_api", str(module_path))
			if spec is None or spec.loader is None:
				return None
			module = importlib.util.module_from_spec(spec)
			spec.loader.exec_module(module)
			GOOGLE_REVIEWS_MODULE = module
		except Exception:
			GOOGLE_REVIEWS_MODULE = None

		return GOOGLE_REVIEWS_MODULE


def fetch_google_reviews_payload(
	attraction_name: str,
	place_hint: Optional[str],
	city: Optional[str],
	country: Optional[str],
	force_refresh: bool = False,
) -> Optional[dict[str, Any]]:
	module = load_google_reviews_module()
	if not module:
		return None
	try:
		return module.fetch_google_reviews_for_attraction(
			attraction_name=attraction_name,
			place_hint=place_hint,
			city=city,
			country=country,
			force_refresh=force_refresh,
		)
	except Exception:
		return None


def ta_get(path: str, params: Optional[dict[str, Any]] = None, retries: int = 3, timeout: int = 25) -> Optional[dict[str, Any]]:
	ta_key = os.getenv("TA_API_KEY")
	if not ta_key:
		return None

	url = f"https://api.content.tripadvisor.com/api/v1{path}"
	query = dict(params or {})
	query["key"] = ta_key
	headers = {"accept": "application/json"}

	for i in range(retries):
		try:
			resp = requests.get(url, headers=headers, params=query, timeout=timeout)
			if resp.status_code == 429:
				time.sleep(0.4 * (2 ** i))
				continue
			if resp.status_code != 200:
				continue
			return resp.json()
		except Exception:
			time.sleep(0.4 * (2 ** i))
	return None


def fetch_tripadvisor_payload(attraction_name: str, city: Optional[str], country: Optional[str]) -> Optional[dict[str, Any]]:
	if not os.getenv("TA_API_KEY"):
		return None

	parts = [attraction_name]
	if city and city.lower() not in attraction_name.lower():
		parts.append(city)
	if country:
		parts.append(country)
	query = ", ".join([p for p in parts if p])

	search = ta_get(
		"/location/search",
		params={
			"searchQuery": query,
			"category": "attractions",
			"language": "en",
		},
	)
	if not search:
		return None

	rows = search.get("data") or []
	if not rows:
		return None

	best = None
	norm_name = normalize_name(attraction_name)
	best_score = -1
	for row in rows[:10]:
		name = row.get("name") or ""
		score = 0
		if normalize_name(name) == norm_name:
			score += 50
		elif norm_name and (norm_name in normalize_name(name) or normalize_name(name) in norm_name):
			score += 20
		if city:
			addr = row.get("address_obj") or {}
			addr_city = (addr.get("city") or "").strip().lower()
			if addr_city and city.lower() in addr_city:
				score += 15
		if row.get("location_id"):
			score += 10
		if score > best_score:
			best_score = score
			best = row

	if not best or not best.get("location_id"):
		return None

	details = ta_get(
		f"/location/{best.get('location_id')}/details",
		params={"language": "en", "currency": "USD"},
	)
	if not details:
		details = {}

	return {
		"query": query,
		"location_id": best.get("location_id"),
		"name": details.get("name") or best.get("name"),
		"description": details.get("description") or "",
		"rating": details.get("rating") if details.get("rating") is not None else best.get("rating"),
		"num_reviews": details.get("num_reviews") if details.get("num_reviews") is not None else best.get("num_reviews"),
		"latitude": details.get("latitude") if details.get("latitude") is not None else best.get("latitude"),
		"longitude": details.get("longitude") if details.get("longitude") is not None else best.get("longitude"),
		"website": details.get("website"),
		"phone": details.get("phone"),
		"tripadvisor_url": details.get("web_url") or best.get("web_url"),
		"address": details.get("address_obj") or best.get("address_obj") or {},
		"ranking_data": details.get("ranking_data") or {},
	}


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	r1 = math.radians(lat1)
	r2 = math.radians(lat2)
	dr = math.radians(lat2 - lat1)
	dl = math.radians(lon2 - lon1)
	a = math.sin(dr / 2) ** 2 + math.cos(r1) * math.cos(r2) * math.sin(dl / 2) ** 2
	c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
	return 6371.0 * c


def compute_distance_from_place_km(place: dict[str, Any], attr_lat: Any, attr_lon: Any) -> Optional[float]:
	try:
		p_lat = float(place.get("place_latitude"))
		p_lon = float(place.get("place_longitude"))
		a_lat = float(attr_lat)
		a_lon = float(attr_lon)
	except (TypeError, ValueError):
		return None

	distance = haversine_km(p_lat, p_lon, a_lat, a_lon)
	return round(distance, 3)


def get_next_canonical_id(supabase: Client) -> int:
	global NEXT_CANONICAL_ID
	if NEXT_CANONICAL_ID is None:
		res = supabase.table("attraction").select("canonical_id").order("canonical_id", desc=True).limit(1).execute()
		top = res.data[0] if res.data else None
		max_id = top.get("canonical_id") if top else None
		try:
			NEXT_CANONICAL_ID = int(max_id) + 1 if max_id is not None else 1
		except Exception:
			NEXT_CANONICAL_ID = 1
	value = NEXT_CANONICAL_ID
	NEXT_CANONICAL_ID += 1
	return value


def generate_embedding(client: OpenAI, text: str) -> Optional[list[float]]:
	if not text.strip():
		return None
	try:
		res = client.embeddings.create(model="text-embedding-3-small", input=[text.replace("\n", " ")])
		return res.data[0].embedding
	except Exception:
		return None


def infer_popularity(review_count: Optional[int], keywords: list[str], rank: int) -> int:
	if review_count and review_count > 0:
		return min(100, int(review_count / 10))

	score = max(10, 100 - (rank * 4))
	lowered = {k.lower() for k in (keywords or [])}
	if {"iconic", "famous", "must-see", "landmark"} & lowered:
		score += 25
	if {"popular", "crowded", "busy"} & lowered:
		score += 15
	if {"hidden gem", "quiet", "secret"} & lowered:
		score -= 5
	return max(1, min(100, score))


def map_price_level(value: Any) -> Optional[int]:
	if isinstance(value, int):
		return value if 0 <= value <= 4 else None
	text = str(value or "").strip().lower()
	mapping = {
		"free": 0,
		"cheap": 1,
		"moderate": 2,
		"expensive": 3,
		"luxury": 4,
		"unknown": None,
	}
	return mapping.get(text)


def _google_text_search(query: str, api_key: str, timeout: int = 20) -> Optional[dict[str, Any]]:
	params = {"query": query, "key": api_key}
	response = requests.get(TEXT_SEARCH_URL, params=params, timeout=timeout)
	if response.status_code != 200:
		return None
	body = response.json()
	results = body.get("results") or []
	return results[0] if results else None


def _google_place_details(place_id: str, api_key: str, timeout: int = 20) -> Optional[dict[str, Any]]:
	params = {
		"place_id": place_id,
		"fields": "name,rating,user_ratings_total,formatted_address,url,reviews,price_level,geometry,photos,types",
		"reviews_sort": "most_relevant",
		"key": api_key,
	}
	response = requests.get(DETAILS_URL, params=params, timeout=timeout)
	if response.status_code != 200:
		return None
	return (response.json() or {}).get("result")


def _google_photo_download(photo_reference: str, api_key: str, max_width: int = 1200, timeout: int = 25) -> tuple[Optional[bytes], Optional[str]]:
	try:
		configured = int(os.getenv("GOOGLE_IMAGE_MAX_WIDTH", "800"))
		if configured >= 320:
			max_width = configured
	except Exception:
		pass

	params = {"maxwidth": max_width, "photo_reference": photo_reference, "key": api_key}
	response = requests.get(PHOTO_URL, params=params, timeout=timeout, allow_redirects=True)
	if response.status_code != 200:
		return None, None
	content_type = response.headers.get("content-type", "image/jpeg")
	if not content_type.startswith("image/"):
		return None, None
	return response.content, content_type


def _summarize_google_reviews(reviews: list[dict[str, Any]], max_reviews: int = 3) -> str:
	parts: list[str] = []
	for review in reviews[:max_reviews]:
		text = (review.get("text") or "").strip()
		if not text:
			continue
		author = review.get("author_name") or "Reviewer"
		rating = review.get("rating")
		prefix = f"{author} ({rating}/5)" if rating is not None else author
		parts.append(f"{prefix}: {text}")
	return " | ".join(parts)


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


def parse_user_place(openai_client: OpenAI, place_input: str, model: str) -> ParsedPlace:
	prompt = f"""
Parse this user place input into city + country.
If country is missing, leave it null.

User input: {place_input}
""".strip()

	completion = openai_client.beta.chat.completions.parse(
		model=model,
		messages=[
			{"role": "system", "content": "Extract structured location fields."},
			{"role": "user", "content": prompt},
		],
		response_format=ParsedPlace,
	)
	parsed = completion.choices[0].message.parsed
	if not parsed or not parsed.city:
		raise RuntimeError("Could not parse place input")
	return parsed


def propose_unbounded_top_attractions(
	openai_client: OpenAI,
	city: str,
	country: Optional[str],
	model: str,
) -> list[AttractionCandidate]:
	display_country = country or "(country unknown)"
	prompt = f"""
You are generating a complete practical set of popular tourist attractions for a place.

Place: {city}, {display_country}

Return a natural-sized list (NO fixed target count):
- Large global destinations should return many attractions.
- Small towns should return only a few major attractions.
- Do not add filler entries just to increase count.

Requirements:
- Focus on places tourists actually visit.
- Include landmarks, museums, districts, viewpoints, parks, and notable experiences.
- Exclude utility/service places like car rentals, airport lounges, banks, and gas stations.
""".strip()

	completion = openai_client.beta.chat.completions.parse(
		model=model,
		messages=[
			{"role": "system", "content": "Return structured attraction candidates for database insertion."},
			{"role": "user", "content": prompt},
		],
		response_format=PlaceAttractionPlan,
	)
	parsed = completion.choices[0].message.parsed
	return parsed.attractions if parsed else []


def upsert_attraction_row(supabase: Client, payload: dict[str, Any], name: str, place_id: int) -> Optional[dict[str, Any]]:
	try:
		res = supabase.table("attraction").upsert(payload, on_conflict="attraction_name,place_id").execute()
		if res.data:
			return res.data[0]
	except Exception:
		pass

	try:
		found = (
			supabase.table("attraction")
			.select("attraction_id,canonical_id")
			.eq("attraction_name", name)
			.eq("place_id", place_id)
			.limit(1)
			.execute()
		)
		if found.data:
			updated = (
				supabase.table("attraction")
				.update(payload)
				.eq("attraction_name", name)
				.eq("place_id", place_id)
				.execute()
			)
			return updated.data[0] if updated.data else found.data[0]

		inserted = supabase.table("attraction").insert(payload).execute()
		return inserted.data[0] if inserted.data else None
	except Exception:
		return None


def place_exists(supabase: Client, city: str) -> Optional[dict[str, Any]]:
	res = (
		supabase.table("place")
		.select("place_id,place_city,place_countryregion")
		.ilike("place_city", city)
		.limit(1)
		.execute()
	)
	return res.data[0] if res.data else None


def parse_place_text_fallback(place_text: str) -> ParsedPlace:
	parts = [p.strip() for p in str(place_text or "").split(",") if p.strip()]
	if not parts:
		raise RuntimeError("Invalid place text")
	city = parts[0]
	country = parts[-1] if len(parts) > 1 else None
	return ParsedPlace(city=city, country=country)


def load_seed_places(seed_file: Path) -> list[str]:
	if not seed_file.exists():
		raise FileNotFoundError(f"Seed file not found: {seed_file}")
	payload = json.loads(seed_file.read_text(encoding="utf-8"))
	if not isinstance(payload, list):
		raise RuntimeError("Seed file must be a JSON array of place strings")
	places: list[str] = []
	for item in payload:
		if isinstance(item, str) and item.strip():
			places.append(item.strip())
	return places


def create_place(supabase: Client, city: str, country: Optional[str], google_maps_key: Optional[str], dry_run: bool) -> dict[str, Any]:
	place_lat = None
	place_lon = None
	place_country = country

	if google_maps_key:
		query = f"{city}, {country}" if country else city
		geo = _google_text_search(query, google_maps_key)
		if geo:
			g_geometry = geo.get("geometry") or {}
			g_location = g_geometry.get("location") or {}
			if isinstance(g_location, dict):
				place_lat = g_location.get("lat")
				place_lon = g_location.get("lng")
			formatted = geo.get("formatted_address") or ""
			if not place_country and isinstance(formatted, str) and "," in formatted:
				parts = [p.strip() for p in formatted.split(",") if p.strip()]
				if parts:
					place_country = parts[-1]

	place_data = {
		"place_city": city,
		"place_countryregion": place_country,
		"place_stateprovince": None,
		"place_latitude": place_lat,
		"place_longitude": place_lon,
	}

	if dry_run:
		return {"place_id": -1, **place_data}

	res = supabase.table("place").upsert(place_data, on_conflict="place_city").execute()
	if not res.data:
		raise RuntimeError("Failed to create place")
	return res.data[0]


def populate_new_place(
	supabase: Client,
	openai_client: OpenAI,
	s3_client: Any,
	place_row: dict[str, Any],
	google_maps_key: Optional[str],
	openai_model: str,
	images_bucket: Optional[str],
	aws_region: str,
	dry_run: bool,
) -> dict[str, int]:
	place_id = place_row.get("place_id")
	city = (place_row.get("place_city") or "").strip()
	country = (place_row.get("place_countryregion") or "").strip() or None

	attractions = propose_unbounded_top_attractions(openai_client, city=city, country=country, model=openai_model)
	if not attractions:
		return {"added": 0, "images": 0, "skipped": 0}

	seen: set[str] = set()
	candidates: list[AttractionCandidate] = []
	for candidate in attractions:
		norm = normalize_name(candidate.name)
		if not norm or norm in seen:
			continue
		seen.add(norm)
		candidates.append(candidate)

	added = 0
	images_added = 0
	skipped = 0

	for rank, candidate in enumerate(candidates, start=1):
		try:
			place_hint = f"{city}, {country}" if country else city
			google_reviews_payload = fetch_google_reviews_payload(
				attraction_name=candidate.name,
				place_hint=place_hint,
				city=candidate.city or city,
				country=country,
				force_refresh=False,
			)
			tripadvisor_payload = fetch_tripadvisor_payload(
				attraction_name=candidate.name,
				city=candidate.city or city,
				country=country,
			)

			search = None
			details = {}
			if google_maps_key:
				q_parts = [candidate.name, candidate.city or city]
				if country:
					q_parts.append(country)
				query = ", ".join([p for p in q_parts if p])
				search = _google_text_search(query, google_maps_key)
				place_ref = search.get("place_id") if search else None
				details = _google_place_details(place_ref, google_maps_key) if place_ref else {}
				details = details or {}

			effective_rating = details.get("rating", (search or {}).get("rating"))
			effective_count = details.get("user_ratings_total", (search or {}).get("user_ratings_total"))
			review_summary_parts: list[str] = []
			google_reviews_summary = _summarize_google_reviews(details.get("reviews") or [])
			if google_reviews_payload and google_reviews_payload.get("google_reviews_summary"):
				google_reviews_summary = google_reviews_payload.get("google_reviews_summary")
			if google_reviews_summary:
				review_summary_parts.append(google_reviews_summary)
			if tripadvisor_payload and tripadvisor_payload.get("description"):
				review_summary_parts.append(str(tripadvisor_payload.get("description"))[:500])
			review_summary = " | ".join([p for p in review_summary_parts if p]).strip()

			if google_reviews_payload:
				if google_reviews_payload.get("google_rating") is not None:
					effective_rating = google_reviews_payload.get("google_rating")
				if google_reviews_payload.get("google_user_ratings_total") is not None:
					effective_count = google_reviews_payload.get("google_user_ratings_total")

			if (effective_rating is None) and tripadvisor_payload and tripadvisor_payload.get("rating") is not None:
				effective_rating = tripadvisor_payload.get("rating")
			if (not effective_count) and tripadvisor_payload and tripadvisor_payload.get("num_reviews") is not None:
				effective_count = tripadvisor_payload.get("num_reviews")

			price_level = details.get("price_level")
			if price_level is None:
				price_level = map_price_level(candidate.estimated_price_level)

			lat = None
			lon = None
			g_geometry = details.get("geometry") or {}
			g_location = g_geometry.get("location") or {}
			if isinstance(g_location, dict):
				lat = g_location.get("lat")
				lon = g_location.get("lng")
			if (lat is None or lon is None) and tripadvisor_payload:
				lat = tripadvisor_payload.get("latitude")
				lon = tripadvisor_payload.get("longitude")

			normalized_rating = None
			if effective_rating is not None:
				try:
					normalized_rating = (float(effective_rating) / 5.0) * 10.0
				except Exception:
					normalized_rating = None

			popularity_score = infer_popularity(
				review_count=int(effective_count) if isinstance(effective_count, (int, float)) else None,
				keywords=candidate.popularity_keywords,
				rank=rank,
			)

			rawdata = {
				"source": "ai_populator",
				"google_place_id": (search or {}).get("place_id"),
				"google_name": details.get("name") or (search or {}).get("name"),
				"google_types": details.get("types") or (search or {}).get("types") or [],
				"google_formatted_address": details.get("formatted_address") or (search or {}).get("formatted_address"),
				"google_maps_url": details.get("url"),
				"category": candidate.category,
				"why_popular": candidate.why_popular,
				"recommended_visit_minutes": candidate.recommended_visit_minutes,
				"google_reviews_payload": google_reviews_payload,
				"tripadvisor_payload": tripadvisor_payload,
			}

			embedding_text = (
				f"{candidate.name}: {candidate.short_summary} "
				f"Popular for: {candidate.why_popular}. Keywords: {', '.join(candidate.popularity_keywords)}"
			)
			if google_reviews_payload and google_reviews_payload.get("google_reviews_summary"):
				embedding_text += f" GoogleReviews: {google_reviews_payload.get('google_reviews_summary')}"
			if tripadvisor_payload and tripadvisor_payload.get("description"):
				embedding_text += f" TripAdvisor: {tripadvisor_payload.get('description')}"
			embedding = generate_embedding(openai_client, embedding_text)

			canonical_id = get_next_canonical_id(supabase)
			attraction_payload = {
				"place_id": place_id,
				"canonical_id": canonical_id,
				"attraction_name": candidate.name,
				"attraction_summary": candidate.short_summary,
				"attraction_vibe": candidate.popularity_keywords[:5],
				"attraction_rawdata": rawdata,
				"attraction_embedding": embedding,
				"attraction_city": candidate.city or city,
				"attraction_stateprovince": place_row.get("place_stateprovince"),
				"attraction_countryregion": country,
				"attraction_latitude": lat,
				"attraction_longitude": lon,
				"attraction_distancefromplace": compute_distance_from_place_km(place_row, lat, lon),
				"attraction_lastrefreshed": datetime.datetime.now(datetime.timezone.utc).isoformat(),
				"attraction_credibilitytier": 3 if (effective_count or 0) >= 1000 else 2,
				"attraction_pricelevel": price_level,
				"attraction_popularityscore": popularity_score,
				"attraction_normalizedrating": normalized_rating,
				"attraction_totalcountratings": effective_count or 0,
				"attraction_reviewssummary": review_summary,
			}

			if dry_run:
				print(f"   [DRY] Would insert attraction: {candidate.name}")
				added += 1
				continue

			inserted = upsert_attraction_row(supabase, attraction_payload, candidate.name, int(place_id))
			if not inserted:
				skipped += 1
				print(f"   ⚠️ Failed insert: {candidate.name}")
				continue

			attraction_id = inserted.get("attraction_id")
			added += 1
			print(f"   ✓ Added attraction: {candidate.name} (id={attraction_id})")

			photos = (details.get("photos") if isinstance(details, dict) else None) or ((search or {}).get("photos") if isinstance(search, dict) else None) or []
			if not photos or not images_bucket or not google_maps_key or not attraction_id:
				continue

			existing_image = (
				supabase.table("images")
				.select("image_url")
				.eq("attraction_id", attraction_id)
				.limit(1)
				.execute()
			)
			if existing_image.data:
				continue

			photo_reference = photos[0].get("photo_reference")
			if not photo_reference:
				continue

			img_bytes, content_type = _google_photo_download(photo_reference, google_maps_key)
			if not img_bytes or not content_type:
				continue

			ext = guess_image_extension(content_type)
			s3_key = f"{place_id}/{attraction_id}/image_0{ext}"
			s3_client.put_object(Bucket=images_bucket, Key=s3_key, Body=img_bytes, ContentType=content_type)
			image_url = build_s3_url(images_bucket, aws_region, s3_key)
			supabase.table("images").insert({"attraction_id": attraction_id, "image_url": image_url}).execute()
			images_added += 1

		except Exception as exc:
			skipped += 1
			print(f"   ⚠️ Error processing {candidate.name}: {exc}")

	return {"added": added, "images": images_added, "skipped": skipped}


def process_one_place_input(
	place_input: str,
	supabase: Client,
	openai_client: OpenAI,
	s3_client: Any,
	openai_model: str,
	google_maps_key: Optional[str],
	images_bucket: Optional[str],
	aws_region: str,
	dry_run: bool,
) -> dict[str, Any]:
	try:
		parsed_place = parse_user_place(openai_client, place_input, openai_model)
	except Exception:
		parsed_place = parse_place_text_fallback(place_input)

	city = parsed_place.city.strip()
	country = parsed_place.country.strip() if parsed_place.country else None
	if not city:
		return {"status": "invalid", "city": "", "added": 0, "images": 0, "skipped": 1}

	existing = place_exists(supabase, city)
	if existing:
		print(f"Place already exists: {existing.get('place_city')} (place_id={existing.get('place_id')})")
		return {"status": "exists", "city": city, "added": 0, "images": 0, "skipped": 0}

	print(f"Creating new place: {city}{', ' + country if country else ''}")
	place_row = create_place(supabase, city, country, google_maps_key, dry_run)

	stats = populate_new_place(
		supabase=supabase,
		openai_client=openai_client,
		s3_client=s3_client,
		place_row=place_row,
		google_maps_key=google_maps_key,
		openai_model=openai_model,
		images_bucket=images_bucket,
		aws_region=aws_region,
		dry_run=dry_run,
	)
	return {"status": "created", "city": city, **stats}


def main() -> None:
	parser = argparse.ArgumentParser(description="Populate a NEW place with OpenAI-generated popular attractions")
	parser.add_argument("--place", type=str, default=None, help="User-provided place text, e.g. 'Paris, France'")
	parser.add_argument("--from-seed", action="store_true", help="Process place list from seed_places.json")
	parser.add_argument(
		"--seed-file",
		type=str,
		default="data/TripAdvisor/seed_places.json",
		help="Path to JSON array of place strings",
	)
	parser.add_argument(
		"--seed-start-index",
		type=int,
		default=0,
		help="0-based index into seed list to start scanning from",
	)
	parser.add_argument("--seed-limit", type=int, default=None, help="Optional max number of seed places to scan")
	parser.add_argument(
		"--target-new-places",
		type=int,
		default=None,
		help="Stop after this many new places are created (skips existing places until target is met)",
	)
	parser.add_argument("--dry-run", action="store_true")
	args = parser.parse_args()

	load_env()
	supabase, openai_client, s3_client = get_clients()

	openai_model = os.getenv("AI_POPULATOR_OPENAI_MODEL", "gpt-4o-mini")
	google_maps_key = os.getenv("GOOGLE_MAPS_API_KEY")
	aws_region = os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"
	images_bucket = os.getenv("S3_IMG_BUCKET_NAME")

	if args.from_seed:
		seed_path = Path(args.seed_file)
		if not seed_path.is_absolute():
			seed_path = Path(__file__).resolve().parents[1] / seed_path

		all_seed_places = load_seed_places(seed_path)
		start_index = max(0, int(args.seed_start_index or 0))
		if start_index >= len(all_seed_places):
			print(f"Seed start index {start_index} is beyond seed list size ({len(all_seed_places)}). Nothing to do.")
			return

		seed_places = all_seed_places[start_index:]
		max_scan = args.seed_limit if args.seed_limit is not None and args.seed_limit > 0 else None
		target_new = args.target_new_places if args.target_new_places is not None and args.target_new_places > 0 else None
		if max_scan is not None:
			seed_places = seed_places[:max_scan]

		print(f"Loaded {len(seed_places)} places from seed list: {seed_path} (start_index={start_index})")
		if target_new is not None:
			print(f"Target new places to create: {target_new}")
		total_created = 0
		total_exists = 0
		total_added = 0
		total_images = 0
		total_skipped = 0
		processed = 0

		for idx, place_input in enumerate(seed_places, start=1):
			if target_new is not None and total_created >= target_new:
				break

			processed += 1
			print(f"\n[{idx}/{len(seed_places)}] Processing: {place_input}")
			result = process_one_place_input(
				place_input=place_input,
				supabase=supabase,
				openai_client=openai_client,
				s3_client=s3_client,
				openai_model=openai_model,
				google_maps_key=google_maps_key,
				images_bucket=images_bucket,
				aws_region=aws_region,
				dry_run=args.dry_run,
			)

			status = result.get("status")
			if status == "created":
				total_created += 1
			elif status == "exists":
				total_exists += 1

			total_added += int(result.get("added", 0))
			total_images += int(result.get("images", 0))
			total_skipped += int(result.get("skipped", 0))

		print("\n✅ Seed run complete")
		print(f"   Places processed: {processed}")
		print(f"   New places created: {total_created}")
		print(f"   Places already existing: {total_exists}")
		print(f"   Attractions inserted/updated: {total_added}")
		print(f"   Images inserted: {total_images}")
		print(f"   Skipped/errors: {total_skipped}")
		return

	place_input = (args.place or "").strip()
	if not place_input:
		place_input = input("Enter a place (e.g. 'Paris, France'): ").strip()
	if not place_input:
		raise RuntimeError("Place input is required")

	result = process_one_place_input(
		place_input=place_input,
		supabase=supabase,
		openai_client=openai_client,
		s3_client=s3_client,
		openai_model=openai_model,
		google_maps_key=google_maps_key,
		images_bucket=images_bucket,
		aws_region=aws_region,
		dry_run=args.dry_run,
	)

	print("\n✅ AI population complete")
	print(f"   Place: {result.get('city') or place_input}")
	print(f"   Status: {result.get('status')}")
	print(f"   Attractions inserted/updated: {result.get('added', 0)}")
	print(f"   Images inserted: {result.get('images', 0)}")
	print(f"   Skipped/errors: {result.get('skipped', 0)}")


if __name__ == "__main__":
	main()
