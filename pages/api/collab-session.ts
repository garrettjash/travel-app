import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";
import { bucketAttractions } from "../../lib/collab-bucket";

type AttractionItem = {
  id: number;
  name: string;
  city: string;
  country: string;
  summary: string;
  vibe: string;
  rating: number | null;
  priceLevel: string;
  categories: string[];
  imageUrl: string | null;
  imageUrls: string[];
};

type SessionAttractionResult = {
  attractionId: number;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
};

type CollabSessionRow = {
  collab_session_id: string;
  created_at: string | null;
  itinerary_id?: string | null;
};

type CollabSessionResponse =
  | {
      sessionId: string;
      placeId: number;
      place: string;
      sessionPath: string;
      attractionsCount: number;
      createdItineraryId?: string | null;
      createdItineraryError?: string | null;
    }
  | {
      sessionId: string;
      placeId: number;
      place: string;
      attractions: AttractionItem[];
      decks?: Array<{
        placeId: number;
        placeName: string;
        attractions: AttractionItem[];
        subdecks?: { label: string; ids: number[] }[];
      }>;
      isExpired?: boolean;
      results?: SessionAttractionResult[];
      itineraryPath?: string;
      expiresAt?: string;
    }
  | { error: string };

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ALLOWED_DURATIONS_MINUTES = [1, 5, 10, 15, 30, 60, 120, 300, 720, 1440] as const;
const DEFAULT_DURATION_MINUTES = 1440;

function sanitizeSessionId(rawValue: unknown) {
  const value = typeof rawValue === "string" ? rawValue : "";
  return value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function sanitizePlaceId(rawValue: unknown) {
  const raw = typeof rawValue === "string" || typeof rawValue === "number" ? Number(rawValue) : NaN;
  if (!Number.isFinite(raw)) return null;
  const value = Math.floor(raw);
  return value > 0 ? value : null;
}

function sanitizePlaceIds(rawValue: unknown) {
  if (!Array.isArray(rawValue)) return [] as number[];
  const ids: number[] = rawValue
    .map((v) => (typeof v === "string" || typeof v === "number" ? Number(v) : NaN))
    .filter(Number.isFinite)
    .map((n) => Math.floor(n))
    .filter((n) => n > 0);
  // dedupe
  return Array.from(new Set(ids));
}

function sanitizeDurationMinutes(rawValue: unknown) {
  const parsed = typeof rawValue === "string" || typeof rawValue === "number" ? Number(rawValue) : NaN;
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : NaN;
  if (!ALLOWED_DURATIONS_MINUTES.includes(normalized as (typeof ALLOWED_DURATIONS_MINUTES)[number])) {
    return null;
  }
  return normalized;
}

function buildTimedSessionId(baseSessionId: string, durationMinutes: number) {
  const suffix = `_d${durationMinutes}`;
  const maxBaseLength = Math.max(1, 80 - suffix.length);
  return `${baseSessionId.slice(0, maxBaseLength)}${suffix}`;
}

function parseDurationFromSessionId(sessionId: string) {
  const match = sessionId.match(/_d(\d+)$/i);
  if (!match) return DEFAULT_DURATION_MINUTES;
  const parsed = Number(match[1]);
  if (!Number.isFinite(parsed)) return DEFAULT_DURATION_MINUTES;
  return parsed;
}

function sanitizePlaceName(rawValue: unknown) {
  const value = typeof rawValue === "string" ? rawValue : "";
  return value
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[^\p{L}\p{N}\s,.'()\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function asString(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function normalizeImageUrl(rawValue: unknown) {
  const value = normalizeText(rawValue);
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;
  return null;
}

function isMissingColumnError(message: string) {
  return (
    /column\s+collab_session\.itinerary_id\s+does\s+not\s+exist/i.test(message) ||
    /could not find.*itinerary_id.*collab_session/i.test(message)
  );
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<CollabSessionResponse>
) {
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (req.method === "POST") {
      const baseSessionId = sanitizeSessionId(req.body?.sessionId);
      const placeIdFromBody = sanitizePlaceId(req.body?.placeId);
      const placeIdsFromBody = sanitizePlaceIds(req.body?.placeIds);
      const placeName = sanitizePlaceName(req.body?.placeName);
      const durationMinutes = sanitizeDurationMinutes(req.body?.durationMinutes);

      if (!baseSessionId || (placeIdsFromBody.length === 0 && !placeIdFromBody && !placeName)) {
        res.status(400).json({ error: "sessionId and at least one placeId or a placeName are required." });
        return;
      }

      if (!durationMinutes) {
        res.status(400).json({ error: "Invalid durationMinutes value." });
        return;
      }


      const sessionId = buildTimedSessionId(baseSessionId, durationMinutes);

      // Resolve place records: prefer explicit placeIds array, then single placeId, then name search
      let resolvedPlaceRows: { place_id: number; place_city: string | null; place_countryregion: string | null }[] = [];
      if (placeIdsFromBody.length > 0) {
        const pRes = await supabase
          .from("place")
          .select("place_id, place_city, place_countryregion")
          .in("place_id", placeIdsFromBody)
          .limit(5000);
        if (pRes.error) {
          res.status(500).json({ error: pRes.error.message });
          return;
        }
        resolvedPlaceRows = (pRes.data ?? []) as typeof resolvedPlaceRows;
      } else if (placeIdFromBody) {
        const pRes = await supabase
          .from("place")
          .select("place_id, place_city, place_countryregion")
          .eq("place_id", placeIdFromBody)
          .limit(1)
          .maybeSingle();
        if (pRes.error) {
          res.status(500).json({ error: pRes.error.message });
          return;
        }
        if (pRes.data) resolvedPlaceRows = [pRes.data as any];
      } else if (placeName) {
        const pattern = `"%${placeName.replace(/[%_\\]/g, "\\$&" )}%"`;
        const pRes = await supabase
          .from("place")
          .select("place_id, place_city, place_countryregion")
          .or(`place_city.ilike.${pattern},place_countryregion.ilike.${pattern}`)
          .limit(50);
        if (pRes.error) {
          res.status(500).json({ error: pRes.error.message });
          return;
        }
        // pick the first matching
        resolvedPlaceRows = (pRes.data ?? []).slice(0, 1) as typeof resolvedPlaceRows;
      }

      if (resolvedPlaceRows.length === 0) {
        res.status(404).json({ error: "Place not found in database." });
        return;
      }

      const resolvedPlaceIds = resolvedPlaceRows.map((r) => Number(r.place_id)).filter(Number.isFinite);

      // Insert session (no collab_place_id column assumed)
      const insertSessionResult = await supabase.from("collab_session").insert({ collab_session_id: sessionId });

      if (insertSessionResult.error) {
        const isDuplicate = insertSessionResult.error.code === "23505";
        res.status(isDuplicate ? 409 : 500).json({ error: insertSessionResult.error.message });
        return;
      }

      // Persist join rows to collab_session_places (schema uses `session_id`)
      const sessionPlaceRows = resolvedPlaceIds.map((pid) => ({ session_id: sessionId, place_id: pid }));
      const insertSessionPlaces = await supabase.from("collab_session_places").insert(sessionPlaceRows);
      if (insertSessionPlaces.error) {
        // rollback session
        await supabase.from("collab_session").delete().eq("collab_session_id", sessionId);
        res.status(500).json({ error: insertSessionPlaces.error.message });
        return;
      }

      const attractionIdsResult = await supabase
        .from("attraction")
        .select("attraction_id, place_id")
        .in("place_id", resolvedPlaceIds)
        .limit(5000);

      if (attractionIdsResult.error) {
        await supabase.from("collab_session").delete().eq("collab_session_id", sessionId);
        res.status(500).json({ error: attractionIdsResult.error.message });
        return;
      }

      const attractionIds = (attractionIdsResult.data ?? [])
        .map((row: any) => Number(row.attraction_id))
        .filter(Number.isFinite);

      if (attractionIds.length > 0) {
        const collabItemsRows = attractionIds.map((attractionId) => ({
          collab_session_id: sessionId,
          attraction_id: attractionId
        }));

        const insertItemsResult = await supabase.from("collab_items").insert(collabItemsRows);

        if (insertItemsResult.error) {
          await supabase.from("collab_session").delete().eq("collab_session_id", sessionId);
          res.status(500).json({ error: insertItemsResult.error.message });
          return;
        }
      }

      const placeNames = resolvedPlaceRows
        .map((r) => normalizeText(r.place_city) || normalizeText(r.place_countryregion))
        .filter(Boolean);
      const collabTitle = placeNames.length > 0 ? placeNames.join(", ") : "your destination";

      // Create a placeholder itinerary now so the logged-in creator owns it
      let createdItineraryId: string | null = null;
      let createdItineraryError: string | null = null;
      try {
        const rawCreatorUserId = asString(req.body?.userId);
        const creatorUserId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawCreatorUserId)
          ? rawCreatorUserId
          : null;

        const placeEntries = resolvedPlaceRows.map((r) => ({
          placeId: Number(r.place_id),
          placeName: normalizeText(r.place_city) || normalizeText(r.place_countryregion) || ""
        }));

        const itineraryId = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2,10)}`;
        const today = new Date();
        const startDate = today.toISOString().slice(0, 10);
        const endDate = new Date(today.getTime() + 1000 * 60 * 60 * 24).toISOString().slice(0, 10);

        const insertRow: Record<string, unknown> = {
          itinerary_id: itineraryId,
          trip_name: `Collab: ${collabTitle}`,
          place: placeEntries,
          start_date: startDate,
          end_date: endDate,
          notes: "",
          days: [],
          unscheduled: []
        };
        if (creatorUserId) insertRow.user_id = creatorUserId;

        const { error: insertErr } = await supabase.from("itinerary").insert(insertRow);
        if (!insertErr) {
          createdItineraryId = itineraryId;
          // Link session -> itinerary if none set (avoid overwriting existing linkage)
          await supabase
            .from("collab_session")
            .update({ itinerary_id: itineraryId })
            .eq("collab_session_id", sessionId)
            .is("itinerary_id", null);
        } else {
          createdItineraryError = insertErr.message;
        }
      } catch {
        // non-fatal; continue creating session even if itinerary insert fails
        createdItineraryError = "exception during itinerary insert";
      }

      res.status(201).json({
        sessionId,
        placeId: resolvedPlaceIds[0] ?? null,
        place: placeNames[0] ?? "",
        sessionPath: `/collaborate/session?session=${encodeURIComponent(sessionId)}`,
        attractionsCount: attractionIds.length,
        createdItineraryId,
        createdItineraryError
      });
      return;
    }

    if (req.method === "GET") {
      const sessionId = sanitizeSessionId(asString(req.query.sessionId));
      const rawUserId = asString(req.query.userId);
      const userId =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
          ? rawUserId
          : null;

      if (!sessionId) {
        res.status(400).json({ error: "sessionId is required." });
        return;
      }

      let sessionResult = await supabase
        .from("collab_session")
        .select("collab_session_id, created_at, itinerary_id")
        .eq("collab_session_id", sessionId)
        .limit(1)
        .maybeSingle<CollabSessionRow>();

      if (sessionResult.error && isMissingColumnError(sessionResult.error.message)) {
        sessionResult = await supabase
          .from("collab_session")
          .select("collab_session_id, created_at")
          .eq("collab_session_id", sessionId)
          .limit(1)
          .maybeSingle<CollabSessionRow>();
      }

      if (sessionResult.error) {
        res.status(500).json({ error: sessionResult.error.message });
        return;
      }

      if (!sessionResult.data) {
        res.status(404).json({ error: "Session not found." });
        return;
      }

      const durationMinutes = parseDurationFromSessionId(sessionResult.data.collab_session_id);
      const createdAtIso = normalizeText(sessionResult.data.created_at);
      const createdAt = Date.parse(createdAtIso);

      let isExpired = false;
      let expiresAtIso: string | undefined;
      if (Number.isFinite(createdAt)) {
        const expiresAt = createdAt + durationMinutes * 60 * 1000;
        isExpired = Date.now() > expiresAt;
        expiresAtIso = new Date(expiresAt).toISOString();
      }

      // Resolve place ids from join table
      let resolvedPlaceIds: number[] = [];
      try {
        const p = await supabase
          .from("collab_session_places")
          .select("place_id")
          .eq("session_id", sessionId)
          .limit(1000);
        if (!p.error && Array.isArray(p.data) && p.data.length > 0) {
          resolvedPlaceIds = (p.data ?? []).map((r: any) => Number(r.place_id)).filter(Number.isFinite);
        }
      } catch {
        resolvedPlaceIds = [];
      }

      // No legacy single-place fallback available when column removed; rely on join table only.

      const [placeRowsResult, itemIdsResult] = await Promise.all([
        resolvedPlaceIds.length > 0
          ? supabase.from("place").select("place_id, place_city").in("place_id", resolvedPlaceIds).limit(1000)
          : Promise.resolve({ data: [], error: null }),
        supabase.from("collab_items").select("attraction_id").eq("collab_session_id", sessionId).limit(5000)
      ] as any);

      if (placeRowsResult && placeRowsResult.error) {
        res.status(500).json({ error: placeRowsResult.error.message });
        return;
      }

      if (itemIdsResult.error) {
        res.status(500).json({ error: itemIdsResult.error.message });
        return;
      }

      const placeNames = Array.isArray(placeRowsResult.data)
        ? (placeRowsResult.data as any[])
            .map((r) => normalizeText(r.place_city) || "")
            .filter(Boolean)
        : [];
      const place = placeNames[0] || "your destination";
      const collabName = placeNames.length > 0 ? placeNames.join(", ") : "your destination";
      const attractionIds = (itemIdsResult.data ?? [])
        .map((row: any) => Number(row.attraction_id))
        .filter(Number.isFinite);

      const pollResult = await supabase
        .from("poll")
        .select("attraction_id, vote")
        .eq("collab_session_id", sessionId)
        .limit(10000);

      if (pollResult.error) {
        res.status(500).json({ error: pollResult.error.message });
        return;
      }

      const resultByAttraction = new Map<number, SessionAttractionResult>();
      for (const row of pollResult.data ?? []) {
        const attractionId = Number(row.attraction_id);
        if (!Number.isFinite(attractionId)) continue;

        const current =
          resultByAttraction.get(attractionId) ??
          {
            attractionId,
            yesVotes: 0,
            noVotes: 0,
            totalVotes: 0
          };

        if (row.vote === true) current.yesVotes += 1;
        if (row.vote === false) current.noVotes += 1;
        current.totalVotes += 1;

        resultByAttraction.set(attractionId, current);
      }

      const results = Array.from(resultByAttraction.values());

      if (attractionIds.length === 0) {
        res.status(200).json({ sessionId, placeId: resolvedPlaceIds[0] ?? null, place, attractions: [], isExpired, results, expiresAt: expiresAtIso });
        return;
      }

      // Fetch attractions and ensure they belong to one of the resolved places
      const attractionsResult = await supabase
        .from("attraction")
        .select(
          "attraction_id, attraction_name, attraction_city, attraction_countryregion, attraction_summary, attraction_vibe, attraction_normalizedrating, attraction_pricelevel, place_id"
        )
        .in("attraction_id", attractionIds)
        .limit(5000);

      if (attractionsResult.error) {
        res.status(500).json({ error: attractionsResult.error.message });
        return;
      }

      // Filter out any attractions that do not match the resolvedPlaceIds
      const filteredAttractionRows = (attractionsResult.data ?? []).filter((row: any) =>
        resolvedPlaceIds.includes(Number(row.place_id))
      );

      const filteredAttractionIds = filteredAttractionRows.map((r: any) => Number(r.attraction_id)).filter(Number.isFinite);

      const [categoryLinksResult, imagesResult] = await Promise.all([
        supabase
          .from("attraction_categories")
          .select("attraction_id, category_id")
          .in("attraction_id", filteredAttractionIds)
          .limit(8000),
        supabase
          .from("images")
          .select("attraction_id, image_url")
          .in("attraction_id", filteredAttractionIds)
          .limit(8000)
      ]);

      if (categoryLinksResult.error) {
        res.status(500).json({ error: categoryLinksResult.error.message });
        return;
      }

      if (imagesResult.error) {
        res.status(500).json({ error: imagesResult.error.message });
        return;
      }

      const categoryIds = Array.from(
        new Set((categoryLinksResult.data ?? []).map((row: any) => Number(row.category_id)).filter(Number.isFinite))
      );

      const categoryNameById = new Map<number, string>();

      if (categoryIds.length > 0) {
        const categoriesResult = await supabase
          .from("category")
          .select("category_id, category_name")
          .in("category_id", categoryIds)
          .limit(2000);

        if (categoriesResult.error) {
          res.status(500).json({ error: categoriesResult.error.message });
          return;
        }

        for (const row of categoriesResult.data ?? []) {
          categoryNameById.set(Number(row.category_id), normalizeText(row.category_name));
        }
      }

      const categoriesByAttraction = new Map<number, string[]>();
      for (const link of categoryLinksResult.data ?? []) {
        const attractionId = Number(link.attraction_id);
        const categoryName = categoryNameById.get(Number(link.category_id));
        if (!categoryName) continue;
        const current = categoriesByAttraction.get(attractionId) ?? [];
        if (!current.includes(categoryName)) {
          current.push(categoryName);
          categoriesByAttraction.set(attractionId, current);
        }
      }

      const imageByAttraction = new Map<number, string[]>();
      for (const image of imagesResult.data ?? []) {
        const attractionId = Number(image.attraction_id);
        const imageUrl = normalizeImageUrl(image.image_url);
        if (!imageUrl) continue;
        const current = imageByAttraction.get(attractionId) ?? [];
        if (!current.includes(imageUrl)) {
          current.push(imageUrl);
          imageByAttraction.set(attractionId, current);
        }
      }

      const positionById = new Map<number, number>();
      filteredAttractionIds.forEach((id, index) => positionById.set(id, index));

      if (filteredAttractionIds.length === 0) {
        res.status(200).json({ sessionId, placeId: resolvedPlaceIds[0] ?? null, place, attractions: [], decks: [], isExpired, results, expiresAt: expiresAtIso });
        return;
      }

      const attractions = (filteredAttractionRows ?? [])
        .map((row: any) => {
          const id = Number(row.attraction_id);
          const imageUrls = imageByAttraction.get(id) ?? [];

          return {
            id,
            name: normalizeText(row.attraction_name) || "Unnamed attraction",
            placeId: Number(row.place_id),
            city: normalizeText(row.attraction_city),
            country: normalizeText(row.attraction_countryregion),
            summary: normalizeText(row.attraction_summary),
            vibe: normalizeText(row.attraction_vibe),
            rating:
              row.attraction_normalizedrating !== null && Number.isFinite(Number(row.attraction_normalizedrating))
                ? Number(row.attraction_normalizedrating)
                : null,
            priceLevel: normalizeText(row.attraction_pricelevel),
            categories: categoriesByAttraction.get(id) ?? [],
            imageUrl: imageUrls[0] ?? null,
            imageUrls
          } as AttractionItem;
        })
        .sort((left, right) => {
          const leftPos = positionById.get(left.id) ?? Number.MAX_SAFE_INTEGER;
          const rightPos = positionById.get(right.id) ?? Number.MAX_SAFE_INTEGER;
          return leftPos - rightPos;
        });

      let itineraryPath: string | undefined;

      // Build decks grouped by placeId. If a deck has >25 attractions and OpenAI key is configured,
      // attempt to create semantic subdecks using the bucket helper.
      const placeNameById = new Map<number, string>();
      if (Array.isArray(placeRowsResult?.data)) {
        for (const r of placeRowsResult.data ?? []) {
          const pid = Number((r as any).place_id);
          if (Number.isFinite(pid)) placeNameById.set(pid, normalizeText((r as any).place_city) || "");
        }
      }

      const decksMap = new Map<number, any[]>();
      for (const a of attractions) {
        const pid = Number((a as any).placeId) || 0;
        const arr = decksMap.get(pid) ?? [];
        arr.push(a);
        decksMap.set(pid, arr);
      }

      const decks: {
        placeId: number;
        placeName: string;
        attractions: AttractionItem[];
        subdecks?: { label: string; ids: number[] }[];
      }[] = [];

      for (const [pid, items] of decksMap.entries()) {
        const placeName = placeNameById.get(pid) ?? "";
        const deck: any = { placeId: pid, placeName, attractions: items };
        if (items.length > 25 && process.env.OPENAI_API_KEY) {
          try {
            const minimal = items.map((it) => ({ id: it.id, name: it.name, summary: it.summary ?? "", categories: it.categories ?? [] }));
            const buck = await bucketAttractions(minimal as any);
            if (buck && (buck as any).buckets) {
              deck.subdecks = (buck as any).buckets.map((b: any) => ({ label: b.label, ids: b.ids }));
            }
          } catch {
            // ignore bucket failures and leave deck without subdecks
          }
        }
        decks.push(deck);
      }

      if (isExpired && results.length > 0) {
        const existingItineraryId = sessionResult.data.itinerary_id;

        if (existingItineraryId) {
          const sortedResults = results
            .filter((r) => r.yesVotes > r.noVotes)
            .sort((a, b) => (b.yesVotes - b.noVotes) - (a.yesVotes - a.noVotes));

          const nameById = new Map(
            attractions.map((a) => [a.id, normalizeText(a.name) || "Unnamed attraction"])
          );
          const unscheduled = sortedResults.map((r) => ({
            attractionId: r.attractionId,
            attractionName: nameById.get(r.attractionId) ?? "Unnamed attraction",
            yesVotes: r.yesVotes,
            noVotes: r.noVotes
          }));

          // Return itineraryPath to owner; if itinerary has no user_id, let logged-in user claim it
          if (userId) {
            const itineraryResult = await supabase
              .from("itinerary")
              .select("user_id")
              .eq("itinerary_id", existingItineraryId)
              .limit(1)
              .maybeSingle<{ user_id: string | null }>();

            if (!itineraryResult.error) {
              const ownerId = itineraryResult.data?.user_id ?? null;
              if (ownerId === userId) {
                itineraryPath = `/solo-planner/${encodeURIComponent(existingItineraryId)}?fromCollab=1`;
              } else if (!ownerId) {
                // Itinerary has no owner (created by guest) - let this user claim it
                await supabase
                  .from("itinerary")
                  .update({ user_id: userId })
                  .eq("itinerary_id", existingItineraryId);
                itineraryPath = `/solo-planner/${encodeURIComponent(existingItineraryId)}?fromCollab=1`;
              }
            }
          }

          // Update the existing itinerary with collab results (unscheduled/top-voted).
          // Always apply (even if empty) so the itinerary isn't left stale/blank.
          try {
            const { error: updateErr } = await supabase
              .from("itinerary")
              .update({ days: [], unscheduled })
              .eq("itinerary_id", existingItineraryId);
            if (updateErr) {
              console.error("[collab-session] Failed to update itinerary with voted places:", updateErr.message);
            }
          } catch (err) {
            console.error("[collab-session] Exception updating itinerary:", err);
          }
        }
        // If there is no existingItineraryId, we no longer create a new itinerary here.
        // The only itinerary for this collab is the one created at session POST time.
      }

      res.status(200).json({ sessionId, placeId: resolvedPlaceIds[0] ?? null, place, attractions, decks, isExpired, results, itineraryPath, expiresAt: expiresAtIso });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
