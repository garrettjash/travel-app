import argparse
import os
import time
from pathlib import Path

from dotenv import load_dotenv
from openai import OpenAI
from supabase import create_client, Client


def load_env():
    repo_root = Path(__file__).resolve().parents[1]
    load_dotenv(repo_root / ".env")
    load_dotenv(repo_root / ".env.local")


def get_clients() -> tuple[Client, OpenAI]:
    supabase_url = os.getenv("SUPABASE_URL")
    supabase_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    if not supabase_url or not supabase_key:
        raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    if not openai_key:
        raise RuntimeError("Missing OPENAI_API_KEY")
    return create_client(supabase_url, supabase_key), OpenAI(api_key=openai_key)


def normalize_vibes(vibes) -> str:
    if not vibes:
        return ""
    if isinstance(vibes, list):
        return ", ".join([v for v in vibes if v])
    if isinstance(vibes, str):
        return vibes
    return str(vibes)


def build_embedding_text(name: str, summary: str, vibes: str, rawtext: str) -> str:
    parts = []
    if name or summary:
        parts.append(f"{name}: {summary}".strip())
    if vibes:
        parts.append(f"Vibe: {vibes}")
    if rawtext:
        parts.append(f"Source: {rawtext}")
    return " ".join([p for p in parts if p])


def generate_embedding(openai_client: OpenAI, text: str) -> list[float] | None:
    try:
        clean = text.replace("\n", " ")
        res = openai_client.embeddings.create(input=[clean], model="text-embedding-3-small")
        return res.data[0].embedding
    except Exception as exc:
        print(f"⚠️  Embedding error: {exc}")
        return None


def fetch_sources_rawtext(supabase: Client, batch_size: int) -> dict[int, str]:
    sources_map: dict[int, str] = {}
    offset = 0
    while True:
        res = (
            supabase.table("attraction_sources")
            .select("attraction_id,attraction_sources_rawtext")
            .range(offset, offset + batch_size - 1)
            .execute()
        )
        rows = res.data or []
        if not rows:
            break
        for row in rows:
            attraction_id = row.get("attraction_id")
            rawtext = (row.get("attraction_sources_rawtext") or "").strip()
            if not attraction_id or not rawtext:
                continue
            current = sources_map.get(attraction_id, "")
            if len(rawtext) > len(current):
                sources_map[attraction_id] = rawtext
        offset += batch_size
    return sources_map


def chunked(items: list[int], size: int):
    for idx in range(0, len(items), size):
        yield items[idx : idx + size]


def backfill_embeddings(
    supabase: Client,
    openai_client: OpenAI,
    sources_map: dict[int, str],
    batch_size: int,
    max_chars: int,
    only_missing: bool,
    dry_run: bool,
):
    attraction_ids = list(sources_map.keys())
    print(f"Found {len(attraction_ids)} attractions with rawtext.")

    updated = 0
    skipped = 0
    for batch in chunked(attraction_ids, batch_size):
        res = (
            supabase.table("attraction")
            .select(
                "attraction_id,attraction_name,attraction_summary,attraction_vibe,attraction_embedding"
            )
            .in_("attraction_id", batch)
            .execute()
        )
        rows = res.data or []
        for row in rows:
            attraction_id = row.get("attraction_id")
            if attraction_id is None:
                continue
            if only_missing and row.get("attraction_embedding"):
                skipped += 1
                continue

            name = row.get("attraction_name") or ""
            summary = row.get("attraction_summary") or ""
            vibes = normalize_vibes(row.get("attraction_vibe"))
            rawtext = sources_map.get(attraction_id, "")[:max_chars]
            embedding_text = build_embedding_text(name, summary, vibes, rawtext)
            if not embedding_text:
                skipped += 1
                continue

            if dry_run:
                updated += 1
                continue

            embedding = generate_embedding(openai_client, embedding_text)
            if not embedding:
                skipped += 1
                continue

            supabase.table("attraction").update({"attraction_embedding": embedding}).eq(
                "attraction_id", attraction_id
            ).execute()
            updated += 1
            if updated % 25 == 0:
                print(f"Updated {updated} attractions...")
            time.sleep(0.1)

    print(f"Done. Updated: {updated}, Skipped: {skipped}.")


def main():
    parser = argparse.ArgumentParser(
        description="Backfill attraction embeddings with attraction_sources_rawtext."
    )
    parser.add_argument("--batch-size", type=int, default=100)
    parser.add_argument("--max-chars", type=int, default=6000)
    parser.add_argument("--only-missing", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    load_env()
    supabase, openai_client = get_clients()
    sources_map = fetch_sources_rawtext(supabase, args.batch_size)
    backfill_embeddings(
        supabase,
        openai_client,
        sources_map,
        args.batch_size,
        args.max_chars,
        args.only_missing,
        args.dry_run,
    )


if __name__ == "__main__":
    main()
