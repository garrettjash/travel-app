from __future__ import annotations

import argparse
import json
import math
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path
from typing import Any, Optional

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field
from supabase import Client, create_client


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = os.getenv("CLEAN_DATA_OPENAI_MODEL", "gpt-4o-mini")
PAGE_SIZE = 1000
NEARBY_DISTANCE_KM = 250.0

SERVICE_TYPE_HINTS = {
	"airport",
	"airport_lounge",
	"atm",
	"bank",
	"bus_station",
	"car_rental",
	"gas_station",
	"hospital",
	"lodging",
	"moving_company",
	"parking",
	"pharmacy",
	"subway_station",
	"taxi_stand",
	"train_station",
	"transit_station",
	"travel_agency",
}

SERVICE_NAME_PATTERNS = [
	r"\bairport\b",
	r"\bairport lounge\b",
	r"\bbusiness lounge\b",
	r"\bvip lounge\b",
	r"\bterminal\s*\d*\b",
	r"\bcar rental\b",
	r"\bauto rental\b",
	r"\brental cars?\b",
	r"\bshuttle service\b",
	r"\btaxi\b",
	r"\btransit\b",
	r"\bmetro\b",
	r"\bsubway\b",
	r"\bbus station\b",
	r"\btrain station\b",
	r"\bparking\b",
	r"\bgas station\b",
	r"\bbank\b",
	r"\batm\b",
	r"\bcurrency exchange\b",
	r"\bpharmacy\b",
	r"\bhospital\b",
	r"\bmedical center\b",
	r"\bauto rentals?\b",
	r"\bground transportation\b",
]

SERVICE_SUMMARY_PATTERNS = [
	r"\bairport lounge\b",
	r"\bcar rental\b",
	r"\bground transportation\b",
	r"\btaxi service\b",
	r"\bshuttle service\b",
	r"\bsubway system\b",
	r"\bmetro system\b",
	r"\bpublic transit\b",
	r"\btransport hub\b",
]

LANDMARK_EXEMPTION_PATTERNS = [
	r"\bgrand central\b",
	r"\bunion station\b",
	r"\bst\.\s*pancras\b",
	r"\bst pancras\b",
	r"\bkanazawa station\b",
	r"\bflinders street station\b",
	r"\bchhatrapati shivaji terminus\b",
	r"\bcentral station\b.*\bhistoric\b",
]

COMPARISON_STOPWORDS = {
	"a",
	"an",
	"and",
	"at",
	"by",
	"for",
	"from",
	"in",
	"of",
	"on",
	"the",
	"to",
	"with",
	"city",
	"district",
	"downtown",
	"historic",
	"museum",
	"park",
	"resort",
	"tour",
	"travel",
	"visitor",
	"center",
	"centre",
	"attraction",
}

MARKETING_NAME_PATTERNS = [
	r"[:|]",
	r"\bfine luxury stays\b",
	r"\bluxury stays\b",
	r"\bbest of\b",
	r"\btop-rated\b",
	r"\bmust-see\b",
	r"\bmust visit\b",
	r"\biconic experience\b",
]

SUBAREA_PREFIX_PATTERNS = [
	r"^(north|south|east|west)\b",
	r"\b(north|south|east|west) rim\b",
	r"\bvisitor center\b",
	r"\bviewpoint\b",
	r"\boverlook\b",
	r"\bentrance\b",
	r"\bgate\b",
]

ATTRACTION_SOURCE_COLUMNS = [
	"source_id",
	"attraction_sources_url",
	"attraction_sources_filename",
	"attraction_sources_rawtext",
	"attraction_sources_sourcesummary",
	"attraction_sources_rating",
	"attraction_sources_maxrating",
	"attraction_sources_countratings",
	"attraction_sources_shortreview",
]


class UselessAttractionDecision(BaseModel):
	remove: bool
	reason: str
	confidence: int = Field(ge=0, le=100)


class DuplicatePairDecision(BaseModel):
	duplicate: bool
	keep_id: Optional[int] = None
	remove_id: Optional[int] = None
	reason: str
	confidence: int = Field(ge=0, le=100)


class UnionFind:
	def __init__(self, values: list[int]) -> None:
		self.parent = {value: value for value in values}

	def find(self, value: int) -> int:
		parent = self.parent[value]
		if parent != value:
			self.parent[value] = self.find(parent)
		return self.parent[value]

	def union(self, a: int, b: int) -> None:
		root_a = self.find(a)
		root_b = self.find(b)
		if root_a != root_b:
			self.parent[root_b] = root_a


def load_env() -> None:
	load_dotenv(ROOT / ".env.local")
	load_dotenv(ROOT / ".env")


def get_supabase_client() -> Client:
	supabase_url = os.getenv("SUPABASE_URL")
	supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
	if not supabase_url or not supabase_key:
		raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
	return create_client(supabase_url, supabase_key)


def get_openai_client(skip_openai: bool) -> Optional[OpenAI]:
	if skip_openai:
		return None
	openai_key = os.getenv("OPENAI_API_KEY")
	if not openai_key:
		return None
	return OpenAI(api_key=openai_key)


def fetch_all_rows(supabase: Client, table: str, select_clause: str) -> list[dict[str, Any]]:
	offset = 0
	rows: list[dict[str, Any]] = []
	while True:
		batch = (
			supabase.table(table)
			.select(select_clause)
			.range(offset, offset + PAGE_SIZE - 1)
			.execute()
		).data or []
		if not batch:
			break
		rows.extend(batch)
		if len(batch) < PAGE_SIZE:
			break
		offset += PAGE_SIZE
	return rows


def safe_int(value: Any) -> int:
	if value is None or value is False:
		return 0
	try:
		return int(float(str(value).replace(",", "").strip()))
	except Exception:
		return 0


def safe_float(value: Any) -> Optional[float]:
	if value is None or value is False:
		return None
	try:
		return float(str(value).replace(",", "").strip())
	except Exception:
		return None


def clean_text(value: Any) -> str:
	return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_name(name: str) -> str:
	text = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
	text = re.sub(r"^(the|a|an)\s+", "", text)
	return re.sub(r"\s+", " ", text).strip()


def normalize_city(value: Any) -> str:
	return normalize_name(clean_text(value))


def normalize_for_duplicate_match(name: str) -> str:
	text = normalize_name(name)
	text = re.sub(r"\([^)]*\)", "", text).strip()
	text = re.sub(r"\bin\s+[a-z0-9\s\-']+$", "", text).strip()
	text = re.sub(r"\b(city|town|village|district|area)\b", "", text).strip()
	return re.sub(r"\s+", " ", text).strip()


def significant_tokens(name: str) -> list[str]:
	tokens = []
	for token in normalize_for_duplicate_match(name).split():
		if len(token) < 3 or token in COMPARISON_STOPWORDS:
			continue
		tokens.append(token)
	return tokens


def token_set(name: str) -> set[str]:
	return set(significant_tokens(name))


def names_are_probable_duplicates(name_a: str, name_b: str) -> bool:
	a = normalize_for_duplicate_match(name_a)
	b = normalize_for_duplicate_match(name_b)
	if not a or not b:
		return False
	if a == b:
		return True
	if len(a) >= 8 and len(b) >= 8 and (a in b or b in a):
		return True
	ratio = SequenceMatcher(None, a, b).ratio()
	if ratio >= 0.92:
		return True
	ta = token_set(a)
	tb = token_set(b)
	if ta and tb:
		inter = len(ta & tb)
		union = len(ta | tb)
		if union and (inter / union) >= 0.80:
			return True
	return False


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
	radius_km = 6371.0
	d_lat = math.radians(lat2 - lat1)
	d_lon = math.radians(lon2 - lon1)
	a = (
		math.sin(d_lat / 2) ** 2
		+ math.cos(math.radians(lat1))
		* math.cos(math.radians(lat2))
		* math.sin(d_lon / 2) ** 2
	)
	c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
	return radius_km * c


def record_lat_lon(record: dict[str, Any]) -> tuple[Optional[float], Optional[float]]:
	lat = safe_float(record.get("attraction_latitude"))
	lon = safe_float(record.get("attraction_longitude"))
	if lat is not None and lon is not None:
		return lat, lon
	lat = safe_float(record.get("place_latitude"))
	lon = safe_float(record.get("place_longitude"))
	return lat, lon


def distance_between_records(record_a: dict[str, Any], record_b: dict[str, Any]) -> Optional[float]:
	lat1, lon1 = record_lat_lon(record_a)
	lat2, lon2 = record_lat_lon(record_b)
	if None in (lat1, lon1, lat2, lon2):
		return None
	return haversine_km(float(lat1), float(lon1), float(lat2), float(lon2))


def raw_google_types(record: dict[str, Any]) -> list[str]:
	raw = record.get("attraction_rawdata")
	if not isinstance(raw, dict):
		return []
	types = raw.get("google_types") or []
	if not isinstance(types, list):
		return []
	return [str(item).strip().lower() for item in types if str(item).strip()]


def is_landmark_exemption(record: dict[str, Any]) -> bool:
	text = " ".join(
		[
			clean_text(record.get("attraction_name")),
			clean_text(record.get("attraction_summary")),
			clean_text(record.get("attraction_reviewssummary")),
		]
	).lower()
	return any(re.search(pattern, text) for pattern in LANDMARK_EXEMPTION_PATTERNS)


def should_review_for_useless(record: dict[str, Any]) -> tuple[bool, str]:
	if is_landmark_exemption(record):
		return False, "landmark exemption"

	name = clean_text(record.get("attraction_name")).lower()
	summary = clean_text(record.get("attraction_summary")).lower()
	for pattern in SERVICE_NAME_PATTERNS:
		if re.search(pattern, name):
			return True, f"name matched pattern: {pattern}"
	for pattern in SERVICE_SUMMARY_PATTERNS:
		if re.search(pattern, summary):
			return True, f"summary matched pattern: {pattern}"
	type_hits = set(raw_google_types(record)) & SERVICE_TYPE_HINTS
	if type_hits:
		return True, f"google_types matched: {sorted(type_hits)}"
	return False, ""


def heuristic_useless_decision(record: dict[str, Any], reason_hint: str) -> Optional[UselessAttractionDecision]:
	if is_landmark_exemption(record):
		return UselessAttractionDecision(remove=False, reason="Historic or landmark exemption", confidence=90)

	text = " ".join(
		[
			clean_text(record.get("attraction_name")),
			clean_text(record.get("attraction_summary")),
			clean_text(record.get("attraction_reviewssummary")),
		]
	).lower()

	high_confidence_patterns = [
		r"\bairport lounge\b",
		r"\bcar rental\b",
		r"\btaxi service\b",
		r"\bshuttle service\b",
		r"\bgas station\b",
		r"\bcurrency exchange\b",
		r"\bpharmacy\b",
		r"\bhospital\b",
		r"\bterminal\s*\d*\b",
	]
	if any(re.search(pattern, text) for pattern in high_confidence_patterns):
		return UselessAttractionDecision(remove=True, reason=reason_hint or "Matched high-confidence service pattern", confidence=96)

	type_hits = set(raw_google_types(record)) & {"airport_lounge", "car_rental", "taxi_stand", "gas_station", "bank", "atm"}
	if type_hits:
		return UselessAttractionDecision(remove=True, reason=f"Matched strong service type hint: {sorted(type_hits)}", confidence=92)

	return None


def summarize_record_for_prompt(record: dict[str, Any]) -> str:
	raw = record.get("attraction_rawdata") if isinstance(record.get("attraction_rawdata"), dict) else {}
	parts = [
		f"id={record.get('attraction_id')}",
		f"name={clean_text(record.get('attraction_name'))}",
		f"place={clean_text(record.get('place_city'))}, {clean_text(record.get('place_countryregion'))}",
		f"summary={clean_text(record.get('attraction_summary')) or '(none)'}",
		f"review_summary={clean_text(record.get('attraction_reviewssummary')) or '(none)'}",
		f"ratings_count={safe_int(record.get('attraction_totalcountratings'))}",
		f"popularity_score={safe_int(record.get('attraction_popularityscore'))}",
		f"image_count={safe_int(record.get('image_count'))}",
		f"source_count={safe_int(record.get('source_count'))}",
	]
	if raw:
		parts.append(f"google_types={raw.get('google_types') or []}")
		parts.append(f"google_address={clean_text(raw.get('google_formatted_address')) or '(none)'}")
		parts.append(f"category={clean_text(raw.get('category')) or '(none)'}")
	return "\n".join(parts)


def decide_useless_with_openai(
	client: Optional[OpenAI],
	record: dict[str, Any],
	model: str,
) -> Optional[UselessAttractionDecision]:
	if client is None:
		return None
	prompt = f"""
Determine if this entry should be removed from a tourist-attractions database.

Remove entries that are mainly transportation or utility services, such as airports, airport lounges, taxi services,
car rentals, parking, banks, pharmacies, hospitals, or generic transit infrastructure.

Keep entries that are genuinely tourist-oriented, architecturally iconic, culturally meaningful, or visited as a destination.
Examples to KEEP: Grand Central Terminal, famous historic stations, iconic terminals.

Record:
{summarize_record_for_prompt(record)}
""".strip()
	try:
		completion = client.beta.chat.completions.parse(
			model=model,
			messages=[
				{"role": "system", "content": "Classify whether entries belong in a tourist attractions database."},
				{"role": "user", "content": prompt},
			],
			response_format=UselessAttractionDecision,
		)
		return completion.choices[0].message.parsed
	except Exception:
		return None


def duplicate_block_keys(record: dict[str, Any]) -> set[str]:
	name = clean_text(record.get("attraction_name"))
	norm = normalize_for_duplicate_match(name)
	tokens = sorted(set(significant_tokens(name)), key=lambda item: (-len(item), item))
	keys = set()
	if norm:
		keys.add(f"norm:{norm}")
	base_before_separator = re.split(r"[:|\-]", norm, maxsplit=1)[0].strip()
	if len(base_before_separator) >= 5:
		keys.add(f"base:{base_before_separator}")
	if tokens:
		keys.add(f"tok1:{tokens[0]}")
	if len(tokens) >= 2:
		keys.add(f"tok2:{'|'.join(sorted(tokens[:2]))}")
	if len(tokens) >= 3:
		keys.add(f"tok3:{'|'.join(sorted(tokens[:3]))}")
	return keys


def cities_match(record_a: dict[str, Any], record_b: dict[str, Any]) -> bool:
	return normalize_city(record_a.get("place_city")) == normalize_city(record_b.get("place_city"))


def countries_conflict(record_a: dict[str, Any], record_b: dict[str, Any]) -> bool:
	country_a = normalize_city(record_a.get("place_countryregion"))
	country_b = normalize_city(record_b.get("place_countryregion"))
	return bool(country_a and country_b and country_a != country_b)


def looks_like_duplicate_candidate(record_a: dict[str, Any], record_b: dict[str, Any]) -> bool:
	if record_a.get("attraction_id") == record_b.get("attraction_id"):
		return False
	if countries_conflict(record_a, record_b):
		return False

	name_a = clean_text(record_a.get("attraction_name"))
	name_b = clean_text(record_b.get("attraction_name"))
	if not name_a or not name_b:
		return False

	norm_a = normalize_for_duplicate_match(name_a)
	norm_b = normalize_for_duplicate_match(name_b)
	if not norm_a or not norm_b:
		return False

	ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
	tokens_a = token_set(name_a)
	tokens_b = token_set(name_b)
	shared = tokens_a & tokens_b
	jaccard = (len(shared) / len(tokens_a | tokens_b)) if (tokens_a or tokens_b) else 0.0
	contains = norm_a in norm_b or norm_b in norm_a
	distance_km = distance_between_records(record_a, record_b)
	nearby = distance_km is None or distance_km <= NEARBY_DISTANCE_KM
	same_place = record_a.get("place_id") == record_b.get("place_id")
	same_city = cities_match(record_a, record_b)

	if names_are_probable_duplicates(name_a, name_b) and (same_place or same_city or nearby):
		return True
	if contains and (same_city or nearby) and (len(shared) >= 1 or ratio >= 0.72):
		return True
	if len(shared) >= 2 and jaccard >= 0.5 and (same_place or same_city or nearby):
		return True
	if same_place and ratio >= 0.72:
		return True
	return False


def build_duplicate_candidates(records: list[dict[str, Any]], max_pairs: Optional[int]) -> list[tuple[int, int]]:
	id_to_record = {int(record["attraction_id"]): record for record in records if record.get("attraction_id") is not None}
	blocks: dict[str, set[int]] = defaultdict(set)
	for record in records:
		attraction_id = record.get("attraction_id")
		if attraction_id is None:
			continue
		for key in duplicate_block_keys(record):
			blocks[key].add(int(attraction_id))

	pairs: set[tuple[int, int]] = set()
	for ids in blocks.values():
		if len(ids) < 2:
			continue
		for a_id, b_id in combinations(sorted(ids), 2):
			if max_pairs is not None and len(pairs) >= max_pairs:
				return sorted(pairs)
			record_a = id_to_record.get(a_id)
			record_b = id_to_record.get(b_id)
			if record_a is None or record_b is None:
				continue
			if looks_like_duplicate_candidate(record_a, record_b):
				pairs.add((a_id, b_id))
	return sorted(pairs)


def name_canonical_penalty(name: str) -> float:
	cleaned = clean_text(name).lower()
	penalty = 0.0
	for pattern in MARKETING_NAME_PATTERNS:
		if re.search(pattern, cleaned):
			penalty += 8.0
	for pattern in SUBAREA_PREFIX_PATTERNS:
		if re.search(pattern, cleaned):
			penalty += 5.0
	if len(cleaned) > 42:
		penalty += 4.0
	return penalty


def score_record_quality(record: dict[str, Any]) -> float:
	name = clean_text(record.get("attraction_name"))
	summary_len = len(clean_text(record.get("attraction_summary")))
	review_len = len(clean_text(record.get("attraction_reviewssummary")))
	image_count = safe_int(record.get("image_count"))
	source_count = safe_int(record.get("source_count"))
	ratings = safe_int(record.get("attraction_totalcountratings"))
	popularity = safe_int(record.get("attraction_popularityscore"))
	raw = record.get("attraction_rawdata") if isinstance(record.get("attraction_rawdata"), dict) else {}
	raw_bonus = min(len(json.dumps(raw, ensure_ascii=False)), 1200) / 120.0 if raw else 0.0
	vibe_bonus = len(record.get("attraction_vibe") or []) * 1.5 if isinstance(record.get("attraction_vibe"), list) else 0.0
	location_bonus = 3.0 if all(value is not None for value in record_lat_lon(record)) else 0.0

	score = 0.0
	score += image_count * 10.0
	score += source_count * 8.0
	score += min(summary_len, 400) / 12.0
	score += min(review_len, 500) / 20.0
	score += math.log10(ratings + 1) * 18.0 if ratings > 0 else 0.0
	score += popularity * 1.5
	score += raw_bonus + vibe_bonus + location_bonus
	score -= name_canonical_penalty(name)
	return score


def heuristic_duplicate_decision(record_a: dict[str, Any], record_b: dict[str, Any]) -> Optional[DuplicatePairDecision]:
	if not looks_like_duplicate_candidate(record_a, record_b):
		return None

	name_a = clean_text(record_a.get("attraction_name"))
	name_b = clean_text(record_b.get("attraction_name"))
	norm_a = normalize_for_duplicate_match(name_a)
	norm_b = normalize_for_duplicate_match(name_b)
	ratio = SequenceMatcher(None, norm_a, norm_b).ratio()
	shared = token_set(name_a) & token_set(name_b)
	if norm_a == norm_b or (ratio >= 0.94) or (len(shared) >= 2 and (norm_a in norm_b or norm_b in norm_a)):
		keeper = record_a if score_record_quality(record_a) >= score_record_quality(record_b) else record_b
		loser = record_b if int(keeper["attraction_id"]) == int(record_a["attraction_id"]) else record_a
		return DuplicatePairDecision(
			duplicate=True,
			keep_id=int(keeper["attraction_id"]),
			remove_id=int(loser["attraction_id"]),
			reason="Strong heuristic duplicate match",
			confidence=88,
		)
	return None


def decide_duplicate_with_openai(
	client: Optional[OpenAI],
	record_a: dict[str, Any],
	record_b: dict[str, Any],
	model: str,
) -> Optional[DuplicatePairDecision]:
	if client is None:
		return None
	prompt = f"""
Determine whether these two records are duplicates for a travel-attractions database.

Duplicate means they refer to the same traveler-facing attraction, including:
- misspellings or naming variants,
- marketing-title variants,
- a sub-area or sectional label that should collapse into the main attraction,
- the same famous attraction attached to nearby but different location labels.

Do NOT mark duplicate if they are truly different attractions, even if they share a brand or similar wording.

Prefer keeping the more canonical or commonly-known attraction name.
If both are the same attraction, pick the single best record to keep based on name quality, completeness, sources, images, and review depth.

Record A:
{summarize_record_for_prompt(record_a)}

Record B:
{summarize_record_for_prompt(record_b)}

If they are not duplicates, set duplicate=false and leave keep_id/remove_id null.
If they are duplicates, keep_id and remove_id must be one of the two provided attraction ids.
""".strip()
	try:
		completion = client.beta.chat.completions.parse(
			model=model,
			messages=[
				{"role": "system", "content": "Decide whether two attraction records should be merged."},
				{"role": "user", "content": prompt},
			],
			response_format=DuplicatePairDecision,
		)
		parsed = completion.choices[0].message.parsed
		if not parsed:
			return None
		valid_ids = {int(record_a["attraction_id"]), int(record_b["attraction_id"])}
		if parsed.duplicate and ({parsed.keep_id, parsed.remove_id} - valid_ids):
			return None
		return parsed
	except Exception:
		return None


def choose_component_keeper(
	component_ids: list[int],
	id_to_record: dict[int, dict[str, Any]],
	decisions: list[DuplicatePairDecision],
) -> int:
	votes: Counter[int] = Counter()
	for decision in decisions:
		if not decision.duplicate or decision.keep_id is None:
			continue
		if decision.keep_id in component_ids:
			votes[decision.keep_id] += max(decision.confidence, 1)

	best_id = component_ids[0]
	best_tuple = (-1, float("-inf"), 0)
	for attraction_id in sorted(component_ids):
		record = id_to_record[attraction_id]
		candidate_tuple = (
			votes[attraction_id],
			score_record_quality(record),
			-safe_int(record.get("attraction_id")),
		)
		if candidate_tuple > best_tuple:
			best_tuple = candidate_tuple
			best_id = attraction_id
	return best_id


def merge_missing_dict_values(primary: Any, secondary: Any) -> Any:
	if not isinstance(primary, dict) or not isinstance(secondary, dict):
		return primary if primary not in (None, "", [], {}) else secondary
	merged = dict(primary)
	for key, value in secondary.items():
		if key not in merged or merged[key] in (None, "", [], {}):
			merged[key] = value
		elif isinstance(merged[key], dict) and isinstance(value, dict):
			merged[key] = merge_missing_dict_values(merged[key], value)
	return merged


def union_vibes(first: Any, second: Any) -> list[str]:
	result: list[str] = []
	seen: set[str] = set()
	for collection in [first, second]:
		if not isinstance(collection, list):
			continue
		for item in collection:
			cleaned = clean_text(item).lower()
			if not cleaned or cleaned in seen:
				continue
			seen.add(cleaned)
			result.append(cleaned)
			if len(result) >= 12:
				return result
	return result


def build_keeper_update_payload(keeper: dict[str, Any], loser: dict[str, Any]) -> dict[str, Any]:
	payload: dict[str, Any] = {}

	keeper_summary = clean_text(keeper.get("attraction_summary"))
	loser_summary = clean_text(loser.get("attraction_summary"))
	if len(loser_summary) > len(keeper_summary):
		payload["attraction_summary"] = loser_summary

	keeper_review = clean_text(keeper.get("attraction_reviewssummary"))
	loser_review = clean_text(loser.get("attraction_reviewssummary"))
	if len(loser_review) > len(keeper_review):
		payload["attraction_reviewssummary"] = loser_review

	merged_vibes = union_vibes(keeper.get("attraction_vibe"), loser.get("attraction_vibe"))
	if merged_vibes and merged_vibes != (keeper.get("attraction_vibe") or []):
		payload["attraction_vibe"] = merged_vibes

	keeper_raw = keeper.get("attraction_rawdata") if isinstance(keeper.get("attraction_rawdata"), dict) else {}
	loser_raw = loser.get("attraction_rawdata") if isinstance(loser.get("attraction_rawdata"), dict) else {}
	merged_raw = merge_missing_dict_values(keeper_raw, loser_raw)
	if merged_raw != keeper_raw:
		payload["attraction_rawdata"] = merged_raw

	for field in [
		"attraction_totalcountratings",
		"attraction_popularityscore",
		"attraction_credibilitytier",
	]:
		if safe_int(loser.get(field)) > safe_int(keeper.get(field)):
			payload[field] = safe_int(loser.get(field))

	if safe_float(keeper.get("attraction_normalizedrating")) is None and safe_float(loser.get("attraction_normalizedrating")) is not None:
		payload["attraction_normalizedrating"] = safe_float(loser.get("attraction_normalizedrating"))

	if keeper.get("attraction_pricelevel") in (None, "", 0) and loser.get("attraction_pricelevel") not in (None, "", 0):
		payload["attraction_pricelevel"] = loser.get("attraction_pricelevel")

	for field in [
		"attraction_latitude",
		"attraction_longitude",
		"attraction_distancefromplace",
		"attraction_city",
		"attraction_stateprovince",
		"attraction_countryregion",
	]:
		if keeper.get(field) in (None, "") and loser.get(field) not in (None, ""):
			payload[field] = loser.get(field)

	payload["attraction_lastrefreshed"] = datetime.now(timezone.utc).isoformat()
	return payload


def transfer_images(supabase: Client, keeper_id: int, loser_id: int) -> None:
	keeper_rows = supabase.table("images").select("image_url").eq("attraction_id", keeper_id).execute().data or []
	keeper_urls = {clean_text(row.get("image_url")) for row in keeper_rows if row.get("image_url")}
	loser_rows = supabase.table("images").select("image_url").eq("attraction_id", loser_id).execute().data or []
	for row in loser_rows:
		url = clean_text(row.get("image_url"))
		if url and url not in keeper_urls:
			supabase.table("images").insert({"attraction_id": keeper_id, "image_url": url}).execute()
			keeper_urls.add(url)
	supabase.table("images").delete().eq("attraction_id", loser_id).execute()


def transfer_sources(supabase: Client, keeper_id: int, loser_id: int) -> None:
	select_clause = ",".join(ATTRACTION_SOURCE_COLUMNS)
	rows = supabase.table("attraction_sources").select(select_clause).eq("attraction_id", loser_id).execute().data or []
	for row in rows:
		payload = {column: row.get(column) for column in ATTRACTION_SOURCE_COLUMNS}
		payload["attraction_id"] = keeper_id
		payload["source_id"] = row.get("source_id")
		if payload.get("source_id") is None:
			continue
		supabase.table("attraction_sources").upsert(payload, on_conflict="attraction_id,source_id").execute()
	supabase.table("attraction_sources").delete().eq("attraction_id", loser_id).execute()


def transfer_categories(supabase: Client, keeper_id: int, loser_id: int) -> None:
	rows = supabase.table("attraction_categories").select("category_id").eq("attraction_id", loser_id).execute().data or []
	for row in rows:
		category_id = row.get("category_id")
		if category_id is None:
			continue
		supabase.table("attraction_categories").upsert(
			{"attraction_id": keeper_id, "category_id": category_id},
			on_conflict="attraction_id,category_id",
		).execute()
	supabase.table("attraction_categories").delete().eq("attraction_id", loser_id).execute()


def merge_duplicate_rows(
	supabase: Client,
	keeper: dict[str, Any],
	loser: dict[str, Any],
	dry_run: bool,
) -> bool:
	keeper_id = int(keeper["attraction_id"])
	loser_id = int(loser["attraction_id"])
	if dry_run:
		return True
	try:
		payload = build_keeper_update_payload(keeper, loser)
		if payload:
			supabase.table("attraction").update(payload).eq("attraction_id", keeper_id).execute()
		transfer_images(supabase, keeper_id, loser_id)
		transfer_sources(supabase, keeper_id, loser_id)
		transfer_categories(supabase, keeper_id, loser_id)
		supabase.table("attraction").delete().eq("attraction_id", loser_id).execute()
		return True
	except Exception:
		return False


def remove_attraction_and_children(supabase: Client, attraction_id: int, dry_run: bool) -> bool:
	if dry_run:
		return True
	try:
		supabase.table("images").delete().eq("attraction_id", attraction_id).execute()
		supabase.table("attraction_sources").delete().eq("attraction_id", attraction_id).execute()
		supabase.table("attraction_categories").delete().eq("attraction_id", attraction_id).execute()
		supabase.table("attraction").delete().eq("attraction_id", attraction_id).execute()
		return True
	except Exception:
		return False


def fetch_places_map(supabase: Client) -> dict[int, dict[str, Any]]:
	rows = fetch_all_rows(
		supabase,
		"place",
		"place_id,place_city,place_countryregion,place_stateprovince,place_latitude,place_longitude",
	)
	result: dict[int, dict[str, Any]] = {}
	for row in rows:
		place_id = row.get("place_id")
		if place_id is None:
			continue
		result[int(place_id)] = row
	return result


def fetch_counts(supabase: Client, table: str) -> dict[int, int]:
	rows = fetch_all_rows(supabase, table, "attraction_id")
	counts: dict[int, int] = {}
	for row in rows:
		attraction_id = row.get("attraction_id")
		if attraction_id is None:
			continue
		key = int(attraction_id)
		counts[key] = counts.get(key, 0) + 1
	return counts


def fetch_attractions(
	supabase: Client,
	places_map: dict[int, dict[str, Any]],
	place_filter: Optional[str],
	country_filter: Optional[str],
	limit_attractions: Optional[int],
) -> list[dict[str, Any]]:
	rows = fetch_all_rows(
		supabase,
		"attraction",
		(
			"attraction_id,place_id,canonical_id,attraction_name,attraction_summary,"
			"attraction_reviewssummary,attraction_vibe,attraction_rawdata,"
			"attraction_totalcountratings,attraction_popularityscore,"
			"attraction_normalizedrating,attraction_credibilitytier,"
			"attraction_pricelevel,attraction_distancefromplace,"
			"attraction_latitude,attraction_longitude,attraction_city,"
			"attraction_stateprovince,attraction_countryregion,attraction_lastrefreshed"
		),
	)
	image_counts = fetch_counts(supabase, "images")
	source_counts = fetch_counts(supabase, "attraction_sources")
	category_counts = fetch_counts(supabase, "attraction_categories")

	filtered: list[dict[str, Any]] = []
	for row in rows:
		place_id = row.get("place_id")
		place = places_map.get(int(place_id)) if place_id is not None else None
		if not place:
			continue

		merged = {**row, **place}
		merged["image_count"] = image_counts.get(int(row["attraction_id"]), 0) if row.get("attraction_id") is not None else 0
		merged["source_count"] = source_counts.get(int(row["attraction_id"]), 0) if row.get("attraction_id") is not None else 0
		merged["category_count"] = category_counts.get(int(row["attraction_id"]), 0) if row.get("attraction_id") is not None else 0

		if place_filter and place_filter.lower() not in clean_text(merged.get("place_city")).lower():
			continue
		if country_filter and country_filter.lower() not in clean_text(merged.get("place_countryregion")).lower():
			continue
		filtered.append(merged)

	filtered.sort(key=lambda row: (clean_text(row.get("place_countryregion")), clean_text(row.get("place_city")), clean_text(row.get("attraction_name"))))
	if limit_attractions is not None:
		return filtered[:limit_attractions]
	return filtered


def maybe_write_report(report_file: Optional[str], payload: dict[str, Any]) -> None:
	if not report_file:
		return
	path = Path(report_file)
	path.parent.mkdir(parents=True, exist_ok=True)
	path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
	parser = argparse.ArgumentParser(
		description="One-time cleanup script for attraction duplicates and non-tourist/service entries."
	)
	parser.add_argument("--apply", action="store_true", help="Actually write changes. Default is preview only.")
	parser.add_argument("--place", type=str, default=None, help="Only inspect places whose city contains this text.")
	parser.add_argument("--country", type=str, default=None, help="Only inspect places whose country contains this text.")
	parser.add_argument("--limit-attractions", type=int, default=None, help="Only inspect the first N attractions after filtering.")
	parser.add_argument("--max-duplicate-pairs", type=int, default=None, help="Cap duplicate pair reviews for testing/cost control.")
	parser.add_argument("--skip-openai", action="store_true", help="Use heuristics only.")
	parser.add_argument("--openai-model", type=str, default=DEFAULT_MODEL)
	parser.add_argument("--min-useless-confidence", type=int, default=70)
	parser.add_argument("--min-duplicate-confidence", type=int, default=75)
	parser.add_argument("--report-file", type=str, default=None, help="Optional JSON report output path.")
	args = parser.parse_args()

	load_env()
	supabase = get_supabase_client()
	openai_client = get_openai_client(skip_openai=args.skip_openai)
	dry_run = not args.apply

	if openai_client is None:
		print("ℹ️ OpenAI unavailable or disabled; using heuristic-only cleanup.")
	else:
		print(f"🤖 OpenAI cleanup enabled with model={args.openai_model}")

	places_map = fetch_places_map(supabase)
	records = fetch_attractions(
		supabase=supabase,
		places_map=places_map,
		place_filter=args.place,
		country_filter=args.country,
		limit_attractions=args.limit_attractions,
	)
	if not records:
		print("No attractions matched the requested filters.")
		return

	print(f"Loaded {len(records)} attraction records for review.")
	mode = "DRY RUN" if dry_run else "APPLY"
	print(f"Mode: {mode}")

	removed_ids: set[int] = set()
	useless_actions: list[dict[str, Any]] = []
	for record in records:
		attraction_id = int(record["attraction_id"])
		needs_review, reason_hint = should_review_for_useless(record)
		if not needs_review:
			continue

		decision = heuristic_useless_decision(record, reason_hint)
		if decision is None or decision.confidence < args.min_useless_confidence:
			decision = decide_useless_with_openai(openai_client, record, args.openai_model) or decision
		if not decision or not decision.remove or decision.confidence < args.min_useless_confidence:
			continue

		ok = remove_attraction_and_children(supabase, attraction_id, dry_run=dry_run)
		if ok:
			removed_ids.add(attraction_id)
			action = {
				"attraction_id": attraction_id,
				"name": clean_text(record.get("attraction_name")),
				"place": f"{clean_text(record.get('place_city'))}, {clean_text(record.get('place_countryregion'))}",
				"reason": decision.reason,
				"confidence": decision.confidence,
			}
			useless_actions.append(action)
			prefix = "[DRY] Remove useless" if dry_run else "🧹 Removed useless"
			print(f"{prefix}: {action['name']} (id={attraction_id}) — {decision.reason} [{decision.confidence}]")

	active_records = [record for record in records if int(record["attraction_id"]) not in removed_ids]
	id_to_record = {int(record["attraction_id"]): record for record in active_records}

	duplicate_pairs = build_duplicate_candidates(active_records, max_pairs=args.max_duplicate_pairs)
	print(f"Duplicate candidate pairs to review: {len(duplicate_pairs)}")

	confirmed_decisions: list[DuplicatePairDecision] = []
	for left_id, right_id in duplicate_pairs:
		record_a = id_to_record[left_id]
		record_b = id_to_record[right_id]
		decision = heuristic_duplicate_decision(record_a, record_b)
		if decision is None or decision.confidence < args.min_duplicate_confidence:
			decision = decide_duplicate_with_openai(openai_client, record_a, record_b, args.openai_model) or decision
		if not decision or not decision.duplicate or decision.confidence < args.min_duplicate_confidence:
			continue
		if decision.keep_id is None or decision.remove_id is None:
			continue
		confirmed_decisions.append(decision)

	duplicate_actions: list[dict[str, Any]] = []
	if confirmed_decisions:
		union_find = UnionFind(list(id_to_record.keys()))
		for decision in confirmed_decisions:
			union_find.union(int(decision.keep_id), int(decision.remove_id))

		components: dict[int, list[int]] = defaultdict(list)
		for attraction_id in id_to_record:
			components[union_find.find(attraction_id)].append(attraction_id)

		for component_ids in components.values():
			if len(component_ids) <= 1:
				continue
			component_decisions = [
				decision
				for decision in confirmed_decisions
				if decision.keep_id in component_ids and decision.remove_id in component_ids
			]
			keeper_id = choose_component_keeper(component_ids, id_to_record, component_decisions)
			keeper = id_to_record[keeper_id]
			for loser_id in sorted(component_ids):
				if loser_id == keeper_id:
					continue
				loser = id_to_record[loser_id]
				ok = merge_duplicate_rows(supabase, keeper=keeper, loser=loser, dry_run=dry_run)
				if not ok:
					continue
				action = {
					"keep_id": keeper_id,
					"keep_name": clean_text(keeper.get("attraction_name")),
					"remove_id": loser_id,
					"remove_name": clean_text(loser.get("attraction_name")),
					"reason": next(
						(
							decision.reason
							for decision in component_decisions
							if {decision.keep_id, decision.remove_id} == {keeper_id, loser_id}
						),
						"Confirmed duplicate cluster",
					),
				}
				duplicate_actions.append(action)
				prefix = "[DRY] Merge duplicate" if dry_run else "🔁 Merged duplicate"
				print(
					f"{prefix}: '{action['remove_name']}' (id={loser_id}) -> "
					f"'{action['keep_name']}' (id={keeper_id})"
				)

	report_payload = {
		"mode": mode,
		"generated_at": datetime.now(timezone.utc).isoformat(),
		"filters": {
			"place": args.place,
			"country": args.country,
			"limit_attractions": args.limit_attractions,
		},
		"summary": {
			"loaded_records": len(records),
			"useless_removed": len(useless_actions),
			"duplicate_merges": len(duplicate_actions),
			"duplicate_pairs_reviewed": len(duplicate_pairs),
			"openai_enabled": openai_client is not None,
		},
		"useless_actions": useless_actions,
		"duplicate_actions": duplicate_actions,
	}
	maybe_write_report(args.report_file, report_payload)

	print("\n✅ Cleanup review complete")
	print(f"   Useless attractions {'planned' if dry_run else 'removed'}: {len(useless_actions)}")
	print(f"   Duplicate merges {'planned' if dry_run else 'completed'}: {len(duplicate_actions)}")
	if args.report_file:
		print(f"   Report written to: {args.report_file}")


if __name__ == "__main__":
	main()
