
from __future__ import annotations

import argparse
import json
import math
import os
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
from difflib import SequenceMatcher

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field
from supabase import Client, create_client


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = os.getenv("CLEAN_DATA_OPENAI_MODEL", "gpt-4o-mini")
PAGE_SIZE = 1000
NEARBY_DISTANCE_KM = 250.0

# thresholds for metro vs regional handling
METRO_KM = float(os.getenv("ADJUST_METRO_KM", 50.0))
REVIEW_KM = float(os.getenv("ADJUST_REVIEW_KM", 100.0))

# heuristics for unknown handling
UNKNOWN_PLACE_NAMES = {"", "unknown", "unknown place", "unnamed"}
# legacy alias (used below) kept in sync with METRO_KM
NEARBY_ASSIGN_KM = METRO_KM


class PlaceAssignmentDecision(BaseModel):
	belongs_here: bool
	suggested_place_city: Optional[str] = None
	suggested_place_country: Optional[str] = None
	reason: str
	confidence: int = Field(ge=0, le=100)


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


def clean_text(value: Any) -> str:
	return re.sub(r"\s+", " ", str(value or "")).strip()


def normalize_place_key(city: Any, country: Any) -> str:
	city_text = clean_text(city).lower()
	country_text = clean_text(country).lower()
	combined = f"{city_text}, {country_text}" if country_text else city_text
	return re.sub(r"\s+", " ", combined).strip()


def title_case_place(city: str, country: Optional[str]) -> str:
	def tc(s: str) -> str:
		return " ".join([p.capitalize() for p in re.split(r"\s+", s.strip()) if p])

	if not city:
		return ""
	city_part = tc(city)
	country_part = tc(country) if country else None
	return f"{city_part}, {country_part}" if country_part else city_part


def normalize_for_duplicate_match(name: str) -> str:
	text = re.sub(r"[^a-z0-9]+", " ", (name or "").lower()).strip()
	text = re.sub(r"\([^)]*\)", "", text).strip()
	text = re.sub(r"\b(city|town|village|district|area)\b", "", text).strip()
	text = re.sub(r"\s+", " ", text)
	text = re.sub(r"^(the|a|an)\s+", "", text).strip()
	return text


def token_set(name: str) -> set[str]:
	tokens = [t for t in normalize_for_duplicate_match(name).split() if len(t) > 2]
	stop = {"museum", "park", "city", "historic", "center", "centre", "attraction"}
	return set(t for t in tokens if t not in stop)


def names_are_probable_duplicates(a: str, b: str) -> bool:
	if not a or not b:
		return False
	na = normalize_for_duplicate_match(a)
	nb = normalize_for_duplicate_match(b)
	if na == nb:
		return True
	ratio = SequenceMatcher(None, na, nb).ratio()
	if ratio >= 0.88:
		return True
	ta = token_set(a)
	tb = token_set(b)
	if ta and tb:
		inter = len(ta & tb)
		union = len(ta | tb)
		if union and (inter / union) >= 0.7:
			return True
	return False


def fetch_places(supabase: Client) -> dict[int, dict[str, Any]]:
	rows = fetch_all_rows(
		supabase,
		"place",
		"place_id,place_city,place_countryregion,place_stateprovince,place_latitude,place_longitude",
	)
	result: dict[int, dict[str, Any]] = {}
	for row in rows:
		pid = row.get("place_id")
		if pid is None:
			continue
		result[int(pid)] = row
	return result


def fetch_attraction_counts(supabase: Client) -> dict[int, int]:
	rows = fetch_all_rows(supabase, "attraction", "place_id")
	counts: dict[int, int] = {}
	for row in rows:
		pid = row.get("place_id")
		if pid is None:
			continue
		key = int(pid)
		counts[key] = counts.get(key, 0) + 1
	return counts


def merge_places(supabase: Client, keeper_id: int, loser_id: int, dry_run: bool) -> bool:
	try:
		if dry_run:
			return True
		# Move attractions to keeper
		supabase.table("attraction").update({"place_id": keeper_id}).eq("place_id", loser_id).execute()
		# Delete the loser place
		supabase.table("place").delete().eq("place_id", loser_id).execute()
		return True
	except Exception:
		return False


def distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
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
	lat = record.get("attraction_latitude") or record.get("place_latitude")
	lon = record.get("attraction_longitude") or record.get("place_longitude")
	try:
		return (float(lat), float(lon))
	except Exception:
		return (None, None)


def summarize_attraction_for_prompt(record: dict[str, Any]) -> str:
	parts = [
		f"id={record.get('attraction_id')}",
		f"name={clean_text(record.get('attraction_name'))}",
		f"assigned_place={clean_text(record.get('place_city'))}, {clean_text(record.get('place_countryregion'))}",
		f"attraction_city_field={clean_text(record.get('attraction_city'))}",
		f"summary={clean_text(record.get('attraction_summary')) or '(none)'}",
		f"lat_lon={(record.get('attraction_latitude'), record.get('attraction_longitude'))}",
	]
	return "\n".join(parts)


def decide_assignment_with_openai(client: Optional[OpenAI], record: dict[str, Any], model: str) -> Optional[PlaceAssignmentDecision]:
	if client is None:
		return None
	prompt = f"""
Decide whether this attraction belongs to its currently assigned place in a travel-attractions database.

If it does not belong, suggest the correct place city and country if obvious from the name/summary or lat/lon.

Record:
{summarize_attraction_for_prompt(record)}
""".strip()
	try:
		completion = client.beta.chat.completions.parse(
			model=model,
			messages=[
				{"role": "system", "content": "Decide if an attraction is correctly assigned to its place and suggest corrections."},
				{"role": "user", "content": prompt},
			],
			response_format=PlaceAssignmentDecision,
		)
		return completion.choices[0].message.parsed
	except Exception:
		return None


def maybe_write_report(report_file: Optional[str], payload: dict[str, Any]) -> None:
	if not report_file:
		return
	path = Path(report_file)
	path.parent.mkdir(parents=True, exist_ok=True)
	path.write_text(json.dumps(payload, indent=2, ensure_ascii=False), encoding="utf-8")


def main() -> None:
	parser = argparse.ArgumentParser(description="Adjust places: merge name variants and detect misassigned attractions.")
	parser.add_argument("--apply", action="store_true", help="Actually write changes. Default is preview only.")
	parser.add_argument("--place", type=str, default=None, help="Only inspect places whose city contains this text.")
	parser.add_argument("--country", type=str, default=None, help="Only inspect places whose country contains this text.")
	parser.add_argument("--skip-openai", action="store_true", help="Use heuristics only.")
	parser.add_argument("--openai-model", type=str, default=DEFAULT_MODEL)
	parser.add_argument("--min-confidence", type=int, default=75)
	parser.add_argument("--report-file", type=str, default=None, help="Optional JSON report output path.")
	args = parser.parse_args()

	load_env()
	supabase = get_supabase_client()
	openai_client = get_openai_client(skip_openai=args.skip_openai)
	dry_run = not args.apply

	if openai_client is None:
		print("ℹ️ OpenAI unavailable or disabled; using heuristic-only adjustments.")
	else:
		print(f"🤖 OpenAI enabled with model={args.openai_model}")

	places = fetch_places(supabase)
	attraction_counts = fetch_attraction_counts(supabase)

	# Apply optional place/country filters to limit scope
	if args.place or args.country:
		filtered_places: dict[int, dict[str, Any]] = {}
		for pid, place in places.items():
			city = clean_text(place.get("place_city") or "").lower()
			country = clean_text(place.get("place_countryregion") or "").lower()
			if args.place and args.place.lower() not in city:
				continue
			if args.country and args.country.lower() not in country:
				continue
			filtered_places[pid] = place
		places = filtered_places

	# Handle unknown/empty place rows: try to reassign their attractions or fill missing fields
	unknown_place_ids = [pid for pid, pl in places.items() if clean_text(pl.get("place_city") or "").lower() in UNKNOWN_PLACE_NAMES]
	unknown_fix_actions: list[dict[str, Any]] = []
	if unknown_place_ids:
		# Build lookup maps by normalized place key
		key_to_place: dict[str, int] = {}
		for pid, pl in places.items():
			k = normalize_place_key(pl.get("place_city"), pl.get("place_countryregion"))
			if k:
				key_to_place[k] = pid

		# Fetch all attractions once (scoped) to avoid many small queries
		all_attractions = fetch_all_rows(supabase, "attraction", "attraction_id,place_id,attraction_name,attraction_city,attraction_countryregion,attraction_latitude,attraction_longitude")

		for unknown_pid in unknown_place_ids:
			if unknown_pid not in places:
				continue
			attractions_for_place = [r for r in all_attractions if r.get("place_id") == unknown_pid]
			for attr in attractions_for_place:
				aid = int(attr.get("attraction_id")) if attr.get("attraction_id") is not None else None
				a_city = clean_text(attr.get("attraction_city") or "")
				a_country = clean_text(attr.get("attraction_countryregion") or "")
				# 1) try exact city+country match to existing place
				target_pid = None
				if a_city:
					k = normalize_place_key(a_city, a_country)
					if k in key_to_place:
						target_pid = key_to_place[k]

				# 2) fallback: nearest place by lat/lon within NEARBY_ASSIGN_KM
				if target_pid is None:
					try:
						lat_a = float(attr.get("attraction_latitude")) if attr.get("attraction_latitude") not in (None, "") else None
						lon_a = float(attr.get("attraction_longitude")) if attr.get("attraction_longitude") not in (None, "") else None
					except Exception:
						lat_a = lon_a = None
					if lat_a is not None and lon_a is not None:
						best_pid = None
						best_dist = float("inf")
						for pid2, pl2 in places.items():
							p_lat = pl2.get("place_latitude")
							p_lon = pl2.get("place_longitude")
							try:
								p_lat_f = float(p_lat) if p_lat not in (None, "") else None
								p_lon_f = float(p_lon) if p_lon not in (None, "") else None
							except Exception:
								p_lat_f = p_lon_f = None
							if None in (p_lat_f, p_lon_f):
								continue
							d = distance_km(lat_a, lon_a, p_lat_f, p_lon_f)
							if d < best_dist:
								best_dist = d
								best_pid = pid2
						if best_pid is not None and best_dist <= NEARBY_ASSIGN_KM:
							target_pid = best_pid

				# If found target and different, reassign
				if target_pid is not None and target_pid != unknown_pid:
					if not dry_run:
						try:
							supabase.table("attraction").update({"place_id": int(target_pid)}).eq("attraction_id", int(aid)).execute()
						except Exception:
							pass
					unknown_fix_actions.append({"action": "reassign", "attraction_id": aid, "from_place": unknown_pid, "to_place": int(target_pid)})
					continue

				# Otherwise, if attraction missing city/country, fill from place
				place_row = places.get(unknown_pid)
				if place_row:
					p_city = clean_text(place_row.get("place_city") or "")
					p_country = clean_text(place_row.get("place_countryregion") or "")
					update_payload = {}
					if not a_city and p_city:
						update_payload["attraction_city"] = p_city
					if not a_country and p_country:
						update_payload["attraction_countryregion"] = p_country
					if update_payload:
						if not dry_run:
							try:
								supabase.table("attraction").update(update_payload).eq("attraction_id", int(aid)).execute()
							except Exception:
								pass
						unknown_fix_actions.append({"action": "fill_fields", "attraction_id": aid, "place_id": unknown_pid, "updates": update_payload})

			# After processing all attractions for the unknown place, delete if empty
				remaining = fetch_attraction_counts(supabase).get(unknown_pid, 0)
			if remaining == 0:
				if not dry_run:
					try:
						supabase.table("place").delete().eq("place_id", int(unknown_pid)).execute()
					except Exception:
						pass
				unknown_fix_actions.append({"action": "delete_place", "place_id": unknown_pid})

	else:
		unknown_fix_actions = []

	# Group places by normalized key (case/whitespace differences)
	key_to_place_ids: dict[str, list[int]] = defaultdict(list)
	for pid, place in places.items():
		key = normalize_place_key(place.get("place_city"), place.get("place_countryregion"))
		key_to_place_ids[key].append(pid)

	merge_actions: list[dict[str, Any]] = []
	# Merge groups where multiple place_ids share the same normalized key
	for key, ids in key_to_place_ids.items():
		if len(ids) <= 1:
			continue
		# choose keeper by attraction count, then smaller place_id
		ids_sorted = sorted(ids, key=lambda i: (-attraction_counts.get(i, 0), i))
		keeper = ids_sorted[0]
		losers = ids_sorted[1:]
		keeper_name = title_case_place(places[keeper].get("place_city") or "", places[keeper].get("place_countryregion"))
		for loser in losers:
			loser_name = title_case_place(places[loser].get("place_city") or "", places[loser].get("place_countryregion"))
			ok = merge_places(supabase, keeper_id=keeper, loser_id=loser, dry_run=dry_run)
			if ok:
				merge_actions.append({"keeper_id": keeper, "keeper_name": keeper_name, "remove_id": loser, "remove_name": loser_name})
				prefix = "[DRY] Merge place" if dry_run else "🔁 Merged place"
				print(f"{prefix}: '{loser_name}' (place_id={loser}) -> '{keeper_name}' (place_id={keeper})")

	# Now scan for potentially misassigned attractions
	select_clause = (
		"attraction_id,place_id,attraction_name,attraction_summary,attraction_latitude,attraction_longitude,"
		"attraction_city,attraction_countryregion"
	)
	attractions = fetch_all_rows(supabase, "attraction", select_clause)

	reassignment_actions: list[dict[str, Any]] = []
	for attr in attractions:
		place_id = attr.get("place_id")
		if place_id is None:
			continue
		place = places.get(int(place_id))
		if not place:
			continue

		# Heuristic decision flow using METRO/REVIEW thresholds
		a_city = clean_text(attr.get("attraction_city") or "").lower()
		p_city = clean_text(place.get("place_city") or "").lower()

		# quick keep: explicit city-field match
		if a_city and p_city and a_city == p_city:
			continue

		# try lat/lon distance where available
		lat_a = attr.get("attraction_latitude")
		lon_a = attr.get("attraction_longitude")
		try:
			lat_a_f = float(lat_a) if lat_a not in (None, "") else None
			lon_a_f = float(lon_a) if lon_a not in (None, "") else None
		except Exception:
			lat_a_f = lon_a_f = None

		p_lat = place.get("place_latitude")
		p_lon = place.get("place_longitude")
		try:
			p_lat_f = float(p_lat) if p_lat not in (None, "") else None
			p_lon_f = float(p_lon) if p_lon not in (None, "") else None
		except Exception:
			p_lat_f = p_lon_f = None

		dist = None
		if None not in (lat_a_f, lon_a_f, p_lat_f, p_lon_f):
			dist = distance_km(lat_a_f, lon_a_f, p_lat_f, p_lon_f)

		# distance-based decisions
		if dist is not None:
			# within metro -> keep assignment
			if dist <= METRO_KM:
				continue
			# in review band -> flag for human/OpenAI review
			if dist <= REVIEW_KM:
				reassignment_actions.append({
					"attraction_id": attr.get("attraction_id"),
					"name": clean_text(attr.get("attraction_name")),
					"current_place": f"{place.get('place_city')}, {place.get('place_countryregion')}",
					"issue": "distance_review",
					"distance_km": dist,
				})
				print(f"[REVIEW] Attraction id={attr.get('attraction_id')} distance={dist:.1f}km needs review")
				continue
			# far away -> attempt to find a closer place within METRO_KM and reassign if found
			best_pid = None
			best_d = float("inf")
			for pid2, pl2 in places.items():
				p2_lat = pl2.get("place_latitude")
				p2_lon = pl2.get("place_longitude")
				try:
					p2_lat_f = float(p2_lat) if p2_lat not in (None, "") else None
					p2_lon_f = float(p2_lon) if p2_lon not in (None, "") else None
				except Exception:
					p2_lat_f = p2_lon_f = None
				if None in (p2_lat_f, p2_lon_f):
					continue
				d2 = distance_km(lat_a_f, lon_a_f, p2_lat_f, p2_lon_f)
				if d2 < best_d:
					best_d = d2
					best_pid = pid2

			if best_pid is not None and best_d <= METRO_KM and best_pid != int(place_id):
				if not dry_run:
					try:
						supabase.table("attraction").update({"place_id": int(best_pid)}).eq("attraction_id", int(attr.get("attraction_id"))).execute()
					except Exception:
						pass
				reassignment_actions.append({
					"attraction_id": attr.get("attraction_id"),
					"name": clean_text(attr.get("attraction_name")),
					"from_place_id": int(place_id),
					"to_place_id": int(best_pid),
					"reason": "nearby_place_found",
					"distance_km": best_d,
				})
				prefix = "[DRY] Reassign" if dry_run else "🔁 Reassigned"
				print(f"{prefix}: attraction id={attr.get('attraction_id')} -> place_id={best_pid} (dist={best_d:.1f}km)")
				continue

			# otherwise flag for review
			reassignment_actions.append({
				"attraction_id": attr.get("attraction_id"),
				"name": clean_text(attr.get("attraction_name")),
				"current_place": f"{place.get('place_city')}, {place.get('place_countryregion')}",
				"issue": "far_distance_no_candidate",
				"distance_km": dist,
			})
			print(f"[REVIEW] Attraction id={attr.get('attraction_id')} far distance={dist:.1f}km with no nearby candidate")
			continue

		# If no distance available, fall back to city-name matching or OpenAI
		if a_city:
			# prefer exact match to another place
			for pid2, pl2 in places.items():
				if a_city == clean_text(pl2.get("place_city") or "").lower():
					if pid2 != int(place_id):
						if not dry_run:
							try:
								supabase.table("attraction").update({"place_id": int(pid2)}).eq("attraction_id", int(attr.get("attraction_id"))).execute()
							except Exception:
								pass
						reassignment_actions.append({
							"attraction_id": attr.get("attraction_id"),
							"name": clean_text(attr.get("attraction_name")),
							"from_place_id": int(place_id),
							"to_place_id": int(pid2),
							"reason": "city_field_match",
						})
						prefix = "[DRY] Reassign" if dry_run else "🔁 Reassigned"
						print(f"{prefix}: attraction id={attr.get('attraction_id')} -> place_id={pid2} (city match)")
						break
			else:
				# no exact city match found; use OpenAI if available for ambiguous cases
				decision = decide_assignment_with_openai(openai_client, attr, args.openai_model)
				if decision is None:
					reassignment_actions.append({
						"attraction_id": attr.get("attraction_id"),
						"name": clean_text(attr.get("attraction_name")),
						"current_place": f"{place.get('place_city')}, {place.get('place_countryregion')}",
						"issue": "no_distance_city_only",
					})
					print(f"[REVIEW] Attraction id={attr.get('attraction_id')} needs manual review (no distance, city only)")
					continue
		else:
			# no useful city or distance -> consult OpenAI or flag
			decision = decide_assignment_with_openai(openai_client, attr, args.openai_model)
		if decision is None:
			# record for manual review
			reassignment_actions.append({
				"attraction_id": attr.get("attraction_id"),
				"name": clean_text(attr.get("attraction_name")),
				"current_place": f"{place.get('place_city')}, {place.get('place_countryregion')}",
				"issue": "heuristic_mismatch",
			})
			print(f"[REVIEW] Attraction id={attr.get('attraction_id')} needs manual review")
			continue

		if not decision.belongs_here and decision.confidence >= args.min_confidence:
			suggested_city = (decision.suggested_place_city or "").strip()
			suggested_country = (decision.suggested_place_country or "").strip()
			suggested_key = normalize_place_key(suggested_city, suggested_country)
			# try to find a matching place in places
			target_place_id = None
			for pid, pl in places.items():
				if normalize_place_key(pl.get("place_city"), pl.get("place_countryregion")) == suggested_key:
					target_place_id = pid
					break

			if target_place_id is not None and target_place_id != int(place_id):
				if not dry_run:
					try:
						supabase.table("attraction").update({"place_id": int(target_place_id)}).eq("attraction_id", int(attr.get("attraction_id"))).execute()
					except Exception:
						pass
				reassignment_actions.append({
					"attraction_id": attr.get("attraction_id"),
					"name": clean_text(attr.get("attraction_name")),
					"from_place_id": int(place_id),
					"to_place_id": int(target_place_id),
					"reason": decision.reason,
					"confidence": decision.confidence,
				})
				prefix = "[DRY] Reassign" if dry_run else "🔁 Reassigned"
				print(f"{prefix}: attraction id={attr.get('attraction_id')} -> place_id={target_place_id} ({decision.confidence}%)")
			else:
				reassignment_actions.append({
					"attraction_id": attr.get("attraction_id"),
					"name": clean_text(attr.get("attraction_name")),
					"current_place": f"{place.get('place_city')}, {place.get('place_countryregion')}",
					"decision": decision.dict(),
				})
				print(f"[REVIEW] Attraction id={attr.get('attraction_id')} flagged by OpenAI: {decision.reason} [{decision.confidence}]")

	report_payload = {
		"generated_at": datetime.now(timezone.utc).isoformat(),
		"place_merges": merge_actions,
		"reassignments": reassignment_actions,
		"unknown_fixes": unknown_fix_actions,
		"openai_enabled": openai_client is not None,
		"mode": "DRY RUN" if dry_run else "APPLY",
	}
	maybe_write_report(args.report_file, report_payload)
	print("\n✅ Place adjustment run complete")


if __name__ == "__main__":
	main()

