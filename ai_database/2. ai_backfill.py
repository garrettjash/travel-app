import argparse
import datetime
import json
import math
import mimetypes
import os
import re
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


class UselessAttractionDecision(BaseModel):
	remove: bool
	reason: str
	confidence: int = Field(ge=0, le=100)


class SummaryRewrite(BaseModel):
	summary: str


NEXT_CANONICAL_ID: Optional[int] = None

NON_TOURIST_TYPE_HINTS = {
	"car_rental",
	"airport",
	"airport_lounge",
	"travel_agency",
	"moving_company",
	"parking",
	"gas_station",
	"bank",
	"atm",
	"lodging",
	"hospital",
	"pharmacy",
	"train_station",
	"bus_station",
	"subway_station",
}

NON_TOURIST_NAME_PATTERNS = [
	r"\bcar rental\b",
	r"\bauto rental\b",
	r"\bairport lounge\b",
	r"\bbusiness lounge\b",
	r"\bterminal\s*\d*\b",
	r"\bparking\b",
	r"\bgas station\b",
	r"\bbank\b",
	r"\batm\b",
	r"\bcurrency exchange\b",
	r"\bpharmacy\b",
	r"\bhospital\b",
	r"\bhotel\b",
	r"\bhostel\b",
	r"\btrain station\b",
	r"\bbus station\b",
]

SUMMARY_PLACEHOLDER_PATTERNS = [
	r"^tripadvisor listing for ",
	r"^tripadvisor entry for ",
	r"^listing for ",
	r"^travel listing for ",
]


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

	score = max(10, 100 - (rank * 6))
	lowered = {k.lower() for k in (keywords or [])}
	if {"iconic", "famous", "must-see", "landmark"} & lowered:
		score += 25
	if {"popular", "crowded", "busy"} & lowered:
		score += 15
	if {"hidden gem", "quiet", "secret"} & lowered:
		score -= 5
	return max(1, min(100, score))


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


def backfill_missing_distance_for_place(supabase: Client, place: dict[str, Any]) -> int:
	place_id = place.get("place_id")
	if not place_id:
		return 0

	try:
		float(place.get("place_latitude"))
		float(place.get("place_longitude"))
	except (TypeError, ValueError):
		return 0

	rows_res = (
		supabase.table("attraction")
		.select("attraction_id,attraction_latitude,attraction_longitude,attraction_distancefromplace")
		.eq("place_id", place_id)
		.is_("attraction_distancefromplace", "null")
		.execute()
	)
	rows = rows_res.data or []
	updated = 0

	for row in rows:
		distance = compute_distance_from_place_km(place, row.get("attraction_latitude"), row.get("attraction_longitude"))
		if distance is None:
			continue
		try:
			supabase.table("attraction").update({"attraction_distancefromplace": distance}).eq(
				"attraction_id", row.get("attraction_id")
			).execute()
			updated += 1
		except Exception:
			continue

	return updated


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


def _summarize_google_reviews(reviews: list[dict[str, Any]], max_reviews: int = 3) -> str:
	snippets: list[str] = []
	for review in reviews[:max_reviews]:
		text = (review.get("text") or "").strip()
		if not text:
			continue
		author = review.get("author_name") or "Reviewer"
		rating = review.get("rating")
		prefix = f"{author} ({rating}/5)" if rating is not None else author
		snippets.append(f"{prefix}: {text}")
	return " | ".join(snippets)


def _google_photo_download(photo_reference: str, api_key: str, max_width: int = 1200, timeout: int = 25) -> tuple[Optional[bytes], Optional[str]]:
	params = {
		"maxwidth": max_width,
		"photo_reference": photo_reference,
		"key": api_key,
	}
	response = requests.get(PHOTO_URL, params=params, timeout=timeout, allow_redirects=True)
	if response.status_code != 200:
		return None, None
	content_type = response.headers.get("content-type", "image/jpeg")
	if not content_type.startswith("image/"):
		return None, None
	return response.content, content_type


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


def propose_top_attractions(
	client: OpenAI,
	city: str,
	country: str,
	target_total: int,
	existing_names: list[str],
	model: str,
) -> list[AttractionCandidate]:
	existing_block = "\n".join(f"- {name}" for name in existing_names[:200])
	prompt = f"""
You are helping fill a travel attractions database.

Return the {target_total} most popular attractions for {city}, {country}.
Avoid duplicates against this existing list:
{existing_block if existing_block else "(none)"}

Requirements:
- Focus on truly popular, mainstream attractions for tourists.
- Include museums, landmarks, neighborhoods, parks, viewpoints, and major experiences.
- Provide a concise short_summary and why_popular.
- Use estimated_price_level from: Free, Cheap, Moderate, Expensive, Luxury, Unknown.
- popularity_keywords should be short tags.
""".strip()

	completion = client.beta.chat.completions.parse(
		model=model,
		messages=[
			{"role": "system", "content": "Return structured attraction candidates."},
			{"role": "user", "content": prompt},
		],
		response_format=PlaceAttractionPlan,
	)
	parsed = completion.choices[0].message.parsed
	return parsed.attractions if parsed else []


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


def _extract_google_types(rawdata: Any) -> list[str]:
	if not isinstance(rawdata, dict):
		return []
	types = rawdata.get("google_types") or []
	if not isinstance(types, list):
		return []
	return [str(t).strip().lower() for t in types if str(t).strip()]


def should_review_for_useless(name: str, rawdata: Any, summary: str) -> tuple[bool, str]:
	lower_name = (name or "").lower()
	for pattern in NON_TOURIST_NAME_PATTERNS:
		if re.search(pattern, lower_name):
			return True, f"name matched pattern: {pattern}"

	google_types = _extract_google_types(rawdata)
	if set(google_types) & NON_TOURIST_TYPE_HINTS:
		return True, f"google_types matched: {set(google_types) & NON_TOURIST_TYPE_HINTS}"

	summary_text = (summary or "").lower()
	if "car rental" in summary_text or "airport lounge" in summary_text:
		return True, "summary indicates utility service"

	return False, ""


def decide_useless_with_openai(
	client: OpenAI,
	name: str,
	city: str,
	country: str,
	summary: str,
	rawdata: Any,
	model: str,
) -> Optional[UselessAttractionDecision]:
	rawdata_text = json.dumps(rawdata, ensure_ascii=False)[:2000] if rawdata is not None else "null"
	prompt = f"""
Determine if this should be removed from a TOURIST attractions database.

Attraction: {name}
City: {city}
Country: {country}
Summary: {summary or '(none)'}
Raw data: {rawdata_text}

Remove if it is mainly a utility/service place, such as:
- car rental, airport lounge, bank/ATM, parking, gas station, pharmacy, hospital, transit station, generic hotel.

Keep if it is genuinely tourist-oriented or culturally meaningful.
""".strip()

	try:
		completion = client.beta.chat.completions.parse(
			model=model,
			messages=[
				{"role": "system", "content": "Classify whether an entry belongs in a tourist-attractions database."},
				{"role": "user", "content": prompt},
			],
			response_format=UselessAttractionDecision,
		)
		return completion.choices[0].message.parsed
	except Exception:
		return None


def needs_summary_refresh(summary: Any) -> bool:
	if summary is None:
		return True
	text = str(summary).strip()
	if not text:
		return True
	if len(text) < 35:
		return True
	lower = text.lower()
	for pattern in SUMMARY_PLACEHOLDER_PATTERNS:
		if re.search(pattern, lower):
			return True
	return False


def rewrite_summary_with_openai(
	client: OpenAI,
	name: str,
	city: str,
	country: str,
	existing_summary: str,
	model: str,
) -> Optional[str]:
	prompt = f"""
Rewrite this attraction summary to be useful for travelers.

Attraction: {name}
City: {city}
Country: {country}
Current summary: {existing_summary or '(none)'}

Requirements:
- 1-2 sentences
- 30-70 words
- Mention what it is and why tourists go
- No filler like 'TripAdvisor listing for...'
- Return only the improved summary
""".strip()

	try:
		completion = client.beta.chat.completions.parse(
			model=model,
			messages=[
				{"role": "system", "content": "Write concise, factual travel summaries."},
				{"role": "user", "content": prompt},
			],
			response_format=SummaryRewrite,
		)
		parsed = completion.choices[0].message.parsed
		if not parsed or not parsed.summary:
			return None
		new_summary = parsed.summary.strip()
		if len(new_summary) < 25:
			return None
		return new_summary
	except Exception:
		return None


def remove_attraction_and_children(supabase: Client, attraction_id: int, dry_run: bool) -> bool:
	if dry_run:
		return True
	try:
		supabase.table("images").delete().eq("attraction_id", attraction_id).execute()
	except Exception:
		pass
	try:
		supabase.table("attraction_sources").delete().eq("attraction_id", attraction_id).execute()
	except Exception:
		pass
	try:
		supabase.table("attraction").delete().eq("attraction_id", attraction_id).execute()
		return True
	except Exception:
		return False


def maintain_existing_attractions(
	supabase: Client,
	openai_client: OpenAI,
	place: dict[str, Any],
	rows: list[dict[str, Any]],
	openai_model: str,
	dry_run: bool,
) -> dict[str, int]:
	city = (place.get("place_city") or "").strip()
	country = (place.get("place_countryregion") or "").strip()

	removed = 0
	updated = 0
	inspected = 0

	for row in rows:
		inspected += 1
		attraction_id = row.get("attraction_id")
		name = row.get("attraction_name") or ""
		summary = row.get("attraction_summary") or ""
		rawdata = row.get("attraction_rawdata")

		if not attraction_id or not name:
			continue

		needs_useless_review, reason_hint = should_review_for_useless(name, rawdata, summary)
		if needs_useless_review:
			decision = decide_useless_with_openai(
				client=openai_client,
				name=name,
				city=city,
				country=country,
				summary=summary,
				rawdata=rawdata,
				model=openai_model,
			)
			if decision and decision.remove and decision.confidence >= 70:
				ok = remove_attraction_and_children(supabase, int(attraction_id), dry_run=dry_run)
				if ok:
					removed += 1
					mode = "[DRY] Would remove" if dry_run else "Removed"
					print(f"   🧹 {mode} useless attraction: {name} (id={attraction_id}) — {decision.reason}")
					continue
			else:
				if dry_run:
					print(f"   [DRY] Kept borderline attraction: {name} ({reason_hint})")

		if needs_summary_refresh(summary):
			new_summary = rewrite_summary_with_openai(
				client=openai_client,
				name=name,
				city=city,
				country=country,
				existing_summary=summary,
				model=openai_model,
			)
			if new_summary and new_summary.strip() and new_summary.strip() != str(summary).strip():
				if dry_run:
					print(f"   [DRY] Would rewrite summary: {name}")
					updated += 1
				else:
					try:
						supabase.table("attraction").update(
							{"attraction_summary": new_summary, "attraction_lastrefreshed": datetime.datetime.now(datetime.timezone.utc).isoformat()}
						).eq("attraction_id", attraction_id).execute()
						updated += 1
						print(f"   ✍️ Rewrote summary: {name} (id={attraction_id})")
					except Exception as exc:
						print(f"   ⚠️ Failed summary update for {name}: {exc}")

	return {"removed": removed, "summaries_updated": updated, "inspected": inspected}


def upsert_attraction_row(supabase: Client, payload: dict[str, Any], name: str, place_id: int) -> Optional[dict[str, Any]]:
	try:
		res = supabase.table("attraction").upsert(payload, on_conflict="attraction_name,place_id").execute()
		if res.data:
			return res.data[0]
	except Exception:
		pass

	# fallback: explicit update/insert
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


def fetch_places(supabase: Client, limit_places: Optional[int] = None, place_filter: Optional[str] = None) -> list[dict[str, Any]]:
	offset = 0
	batch = 200
	places: list[dict[str, Any]] = []

	while True:
		query = supabase.table("place").select(
			"place_id,place_city,place_countryregion,place_stateprovince,place_latitude,place_longitude"
		)
		if place_filter:
			query = query.eq("place_city", place_filter)
		query = query.range(offset, offset + batch - 1)
		res = query.execute()
		rows = res.data or []
		if not rows:
			break

		places.extend(rows)
		if limit_places is not None and len(places) >= limit_places:
			return places[:limit_places]

		if place_filter:
			break
		offset += batch

	return places


def process_place(
	supabase: Client,
	openai_client: OpenAI,
	s3_client: Any,
	place: dict[str, Any],
	google_maps_key: str,
	openai_model: str,
	target_total: int,
	max_new_per_place: int,
	images_bucket: Optional[str],
	aws_region: str,
	dry_run: bool,
) -> dict[str, int]:
	place_id = place.get("place_id")
	city = (place.get("place_city") or "").strip()
	country = (place.get("place_countryregion") or "").strip()
	display_country = country or "Unknown"

	if not place_id or not city:
		return {"added": 0, "images": 0, "skipped": 0, "removed": 0, "summaries_updated": 0}

	print(f"\n🌍 Processing {city}, {display_country} (place_id={place_id})")
	distance_updated = backfill_missing_distance_for_place(supabase, place)
	if distance_updated:
		print(f"   ✓ Backfilled missing distances: {distance_updated}")

	current_res = (
		supabase.table("attraction")
		.select("attraction_id,attraction_name,attraction_summary,attraction_rawdata")
		.eq("place_id", place_id)
		.execute()
	)
	current_rows = current_res.data or []
	maintenance_stats = maintain_existing_attractions(
		supabase=supabase,
		openai_client=openai_client,
		place=place,
		rows=current_rows,
		openai_model=openai_model,
		dry_run=dry_run,
	)
	if maintenance_stats["removed"] or maintenance_stats["summaries_updated"]:
		print(
			f"   ✓ Existing cleanup: removed={maintenance_stats['removed']}, "
			f"summaries_updated={maintenance_stats['summaries_updated']}"
		)

	# Refresh current rows after deletions/updates
	current_res = (
		supabase.table("attraction")
		.select("attraction_id,attraction_name")
		.eq("place_id", place_id)
		.execute()
	)
	current_rows = current_res.data or []
	existing_names = [r.get("attraction_name") for r in current_rows if r.get("attraction_name")]
	existing_norm = {normalize_name(name) for name in existing_names}

	print(f"   Existing attractions: {len(existing_names)}")

	try:
		proposed = propose_top_attractions(
			client=openai_client,
			city=city,
			country=display_country,
			target_total=target_total,
			existing_names=existing_names,
			model=openai_model,
		)
	except Exception as exc:
		print(f"   ⚠️ OpenAI generation failed: {exc}")
		return {"added": 0, "images": 0, "skipped": 0}

	deduped_candidates: list[AttractionCandidate] = []
	seen = set(existing_norm)
	for candidate in proposed:
		norm = normalize_name(candidate.name)
		if not norm or norm in seen:
			continue
		seen.add(norm)
		deduped_candidates.append(candidate)

	if not deduped_candidates:
		print("   ✓ No missing top attractions detected")
		return {
			"added": 0,
			"images": 0,
			"skipped": 0,
			"removed": maintenance_stats["removed"],
			"summaries_updated": maintenance_stats["summaries_updated"],
		}

	to_add = deduped_candidates[:max_new_per_place]
	print(f"   Missing top attractions identified: {len(deduped_candidates)} (adding up to {len(to_add)})")

	added = 0
	images_added = 0
	skipped = 0

	for rank, candidate in enumerate(to_add, start=1):
		query_parts = [candidate.name, candidate.city or city]
		if country:
			query_parts.append(country)
		query = ", ".join([p for p in query_parts if p])

		try:
			search = _google_text_search(query, google_maps_key)
			if not search:
				skipped += 1
				print(f"      ⊘ No Google place result for: {candidate.name}")
				continue

			google_place_id = search.get("place_id")
			details = _google_place_details(google_place_id, google_maps_key) if google_place_id else {}
			details = details or {}

			effective_rating = details.get("rating", search.get("rating"))
			effective_count = details.get("user_ratings_total", search.get("user_ratings_total"))
			reviews = details.get("reviews") or []
			review_summary = _summarize_google_reviews(reviews)
			price_level = details.get("price_level")
			if price_level is None:
				price_level = map_price_level(candidate.estimated_price_level)

			lat = None
			lon = None
			geom = details.get("geometry") or {}
			location = geom.get("location") or {}
			if isinstance(location, dict):
				lat = location.get("lat")
				lon = location.get("lng")

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
				"source": "openai_backfill",
				"google_place_id": google_place_id,
				"google_name": details.get("name") or search.get("name"),
				"google_types": details.get("types") or search.get("types") or [],
				"google_formatted_address": details.get("formatted_address") or search.get("formatted_address"),
				"google_maps_url": details.get("url"),
				"recommended_visit_minutes": candidate.recommended_visit_minutes,
				"category": candidate.category,
				"why_popular": candidate.why_popular,
			}

			embedding_text = (
				f"{candidate.name}: {candidate.short_summary} "
				f"Popular for: {candidate.why_popular}. Keywords: {', '.join(candidate.popularity_keywords)}"
			)
			embedding = generate_embedding(openai_client, embedding_text)

			existing_res = (
				supabase.table("attraction")
				.select("attraction_id,canonical_id")
				.eq("attraction_name", candidate.name)
				.eq("place_id", place_id)
				.limit(1)
				.execute()
			)
			existing_row = existing_res.data[0] if existing_res.data else None
			canonical_id = existing_row.get("canonical_id") if existing_row else None
			if not canonical_id:
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
				"attraction_stateprovince": place.get("place_stateprovince"),
				"attraction_countryregion": country or None,
				"attraction_latitude": lat,
				"attraction_longitude": lon,
				"attraction_distancefromplace": compute_distance_from_place_km(place, lat, lon),
				"attraction_lastrefreshed": datetime.datetime.now(datetime.timezone.utc).isoformat(),
				"attraction_credibilitytier": 3 if (effective_count or 0) >= 1000 else 2,
				"attraction_pricelevel": price_level,
				"attraction_popularityscore": popularity_score,
				"attraction_normalizedrating": normalized_rating,
				"attraction_totalcountratings": effective_count or 0,
				"attraction_reviewssummary": review_summary,
			}

			if dry_run:
				print(f"      [DRY] Would upsert attraction: {candidate.name}")
				added += 1
				continue

			attr_row = upsert_attraction_row(supabase, attraction_payload, candidate.name, place_id)
			if not attr_row:
				skipped += 1
				print(f"      ⚠️ Failed to upsert: {candidate.name}")
				continue

			attraction_id = attr_row.get("attraction_id")
			if not attraction_id:
				skipped += 1
				print(f"      ⚠️ Missing attraction_id after upsert: {candidate.name}")
				continue

			added += 1
			print(f"      ✓ Upserted: {candidate.name} (id={attraction_id})")

			# Image handling via Google Places photo API
			photos = details.get("photos") or search.get("photos") or []
			if not photos:
				print("        ⊘ No Google photos")
				continue

			existing_image = (
				supabase.table("images")
				.select("image_url")
				.eq("attraction_id", attraction_id)
				.limit(1)
				.execute()
			)
			if existing_image.data:
				print("        ✓ Image already exists")
				continue

			if not images_bucket:
				print("        ⚠️ Missing S3_IMG_BUCKET_NAME, cannot store image")
				continue

			photo_reference = photos[0].get("photo_reference")
			if not photo_reference:
				print("        ⊘ Photo missing photo_reference")
				continue

			img_bytes, content_type = _google_photo_download(photo_reference, google_maps_key)
			if not img_bytes or not content_type:
				print("        ⚠️ Google photo download failed")
				continue

			ext = guess_image_extension(content_type)
			s3_key = f"{place_id}/{attraction_id}/image_0{ext}"
			s3_client.put_object(
				Bucket=images_bucket,
				Key=s3_key,
				Body=img_bytes,
				ContentType=content_type,
			)
			image_url = build_s3_url(images_bucket, aws_region, s3_key)
			supabase.table("images").insert({"attraction_id": attraction_id, "image_url": image_url}).execute()
			images_added += 1
			print(f"        ✓ Image stored: {image_url}")

		except Exception as exc:
			skipped += 1
			print(f"      ⚠️ Error for {candidate.name}: {exc}")

	return {
		"added": added,
		"images": images_added,
		"skipped": skipped,
		"removed": maintenance_stats["removed"],
		"summaries_updated": maintenance_stats["summaries_updated"],
	}


def main() -> None:
	parser = argparse.ArgumentParser(description="Backfill missing popular attractions per place using OpenAI + Google Maps")
	parser.add_argument("--place", type=str, default=None, help="Only process this exact place_city")
	parser.add_argument("--target-total", type=int, default=int(os.getenv("BACKFILL_TARGET_TOTAL", "15")))
	parser.add_argument("--max-new-per-place", type=int, default=int(os.getenv("BACKFILL_MAX_NEW_PER_PLACE", "8")))
	parser.add_argument("--limit-places", type=int, default=None)
	parser.add_argument("--dry-run", action="store_true")
	args = parser.parse_args()

	load_env()

	google_maps_key = os.getenv("GOOGLE_MAPS_API_KEY")
	aws_region = os.getenv("AWS_DEFAULT_REGION") or os.getenv("AWS_REGION") or "us-east-1"
	images_bucket = os.getenv("S3_IMG_BUCKET_NAME")
	openai_model = os.getenv("BACKFILL_OPENAI_MODEL", "gpt-4o-mini")

	if not google_maps_key:
		raise RuntimeError("Missing GOOGLE_MAPS_API_KEY")

	supabase, openai_client, s3_client = get_clients()
	places = fetch_places(supabase, limit_places=args.limit_places, place_filter=args.place)

	if not places:
		print("No matching places found.")
		return

	print(f"Found {len(places)} place(s) to process")
	print(f"target_total={args.target_total}, max_new_per_place={args.max_new_per_place}, dry_run={args.dry_run}")

	total_added = 0
	total_images = 0
	total_skipped = 0
	total_removed = 0
	total_summaries_updated = 0

	for place in places:
		stats = process_place(
			supabase=supabase,
			openai_client=openai_client,
			s3_client=s3_client,
			place=place,
			google_maps_key=google_maps_key,
			openai_model=openai_model,
			target_total=args.target_total,
			max_new_per_place=args.max_new_per_place,
			images_bucket=images_bucket,
			aws_region=aws_region,
			dry_run=args.dry_run,
		)
		total_added += stats["added"]
		total_images += stats["images"]
		total_skipped += stats["skipped"]
		total_removed += stats.get("removed", 0)
		total_summaries_updated += stats.get("summaries_updated", 0)

	print("\n✅ Backfill complete")
	print(f"   Attractions added/updated: {total_added}")
	print(f"   Images added: {total_images}")
	print(f"   Useless attractions removed: {total_removed}")
	print(f"   Weak summaries rewritten: {total_summaries_updated}")
	print(f"   Skipped/errors: {total_skipped}")


if __name__ == "__main__":
	main()
