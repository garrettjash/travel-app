
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

from dotenv import load_dotenv
from openai import OpenAI
from pydantic import BaseModel, Field
from supabase import Client, create_client


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_MODEL = os.getenv("CLEAN_DATA_OPENAI_MODEL", "gpt-4o-mini")
PAGE_SIZE = 1000
NEARBY_DISTANCE_KM = 250.0


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

		# Heuristic: if attraction's own city field (if present) doesn't match place city, or distance > threshold
		a_city = clean_text(attr.get("attraction_city") or "").lower()
		p_city = clean_text(place.get("place_city") or "").lower()
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

		far = False
		if None not in (lat_a_f, lon_a_f, p_lat_f, p_lon_f):
			dist = distance_km(lat_a_f, lon_a_f, p_lat_f, p_lon_f)
			if dist > NEARBY_DISTANCE_KM:
				far = True
		suspect_city_mismatch = bool(a_city and p_city and a_city != p_city)

		if not (far or suspect_city_mismatch):
			continue

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
		"openai_enabled": openai_client is not None,
		"mode": "DRY RUN" if dry_run else "APPLY",
	}
	maybe_write_report(args.report_file, report_payload)
	print("\n✅ Place adjustment run complete")


if __name__ == "__main__":
	main()

