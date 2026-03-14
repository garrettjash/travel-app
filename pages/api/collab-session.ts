import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

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
  collab_place_id: number | string | null;
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
    }
  | {
      sessionId: string;
      placeId: number;
      place: string;
      attractions: AttractionItem[];
      isExpired?: boolean;
      results?: SessionAttractionResult[];
      itineraryPath?: string;
    }
  | { error: string };

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const ALLOWED_DURATIONS_MINUTES = [5, 10, 15, 30, 60, 120, 300, 720, 1440] as const;
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
      const placeName = sanitizePlaceName(req.body?.placeName);
      const durationMinutes = sanitizeDurationMinutes(req.body?.durationMinutes);

      if (!baseSessionId || (!placeIdFromBody && !placeName)) {
        res.status(400).json({ error: "sessionId and either placeId or placeName are required." });
        return;
      }

      if (!durationMinutes) {
        res.status(400).json({ error: "Invalid durationMinutes value." });
        return;
      }

      const sessionId = buildTimedSessionId(baseSessionId, durationMinutes);

      const placeQuery = supabase
        .from("place")
        .select("place_id, place_city, place_countryregion")
        .limit(1);

      const placeResult = placeIdFromBody
        ? await placeQuery.eq("place_id", placeIdFromBody).maybeSingle()
        : await placeQuery.or(`place_city.ilike.${placeName},place_countryregion.ilike.${placeName}`).maybeSingle();

      if (placeResult.error) {
        res.status(500).json({ error: placeResult.error.message });
        return;
      }

      const placeId = Number(placeResult.data?.place_id);
      const place =
        normalizeText(placeResult.data?.place_city) || normalizeText(placeResult.data?.place_countryregion);

      if (!Number.isFinite(placeId) || !place) {
        res.status(404).json({ error: "Place not found in database." });
        return;
      }

      const insertSessionResult = await supabase
        .from("collab_session")
        .insert({
          collab_session_id: sessionId,
          collab_place_id: placeId
        });

      if (insertSessionResult.error) {
        const isDuplicate = insertSessionResult.error.code === "23505";
        res.status(isDuplicate ? 409 : 500).json({ error: insertSessionResult.error.message });
        return;
      }

      const attractionIdsResult = await supabase
        .from("attraction")
        .select("attraction_id")
        .eq("place_id", placeId)
        .limit(5000);

      if (attractionIdsResult.error) {
        await supabase.from("collab_session").delete().eq("collab_session_id", sessionId);
        res.status(500).json({ error: attractionIdsResult.error.message });
        return;
      }

      const attractionIds = (attractionIdsResult.data ?? [])
        .map((row) => Number(row.attraction_id))
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

      res.status(201).json({
        sessionId,
        placeId,
        place,
        sessionPath: `/collaborate/session?place=${encodeURIComponent(place)}&session=${encodeURIComponent(sessionId)}`,
        attractionsCount: attractionIds.length
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
        .select("collab_session_id, collab_place_id, created_at, itinerary_id")
        .eq("collab_session_id", sessionId)
        .limit(1)
        .maybeSingle<CollabSessionRow>();

      if (sessionResult.error && isMissingColumnError(sessionResult.error.message)) {
        sessionResult = await supabase
          .from("collab_session")
          .select("collab_session_id, collab_place_id, created_at")
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
      if (Number.isFinite(createdAt)) {
        const expiresAt = createdAt + durationMinutes * 60 * 1000;
        isExpired = Date.now() > expiresAt;
      }

      const placeId = Number(sessionResult.data.collab_place_id);

      const [placeResult, itemIdsResult] = await Promise.all([
        supabase
          .from("place")
          .select("place_city")
          .eq("place_id", placeId)
          .limit(1)
          .maybeSingle(),
        supabase
          .from("collab_items")
          .select("attraction_id")
          .eq("collab_session_id", sessionId)
          .limit(5000)
      ]);

      if (placeResult.error) {
        res.status(500).json({ error: placeResult.error.message });
        return;
      }

      if (itemIdsResult.error) {
        res.status(500).json({ error: itemIdsResult.error.message });
        return;
      }

      const place = normalizeText(placeResult.data?.place_city) || "your destination";
      const attractionIds = (itemIdsResult.data ?? [])
        .map((row) => Number(row.attraction_id))
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
        res.status(200).json({ sessionId, placeId, place, attractions: [], isExpired, results });
        return;
      }

      const attractionsResult = await supabase
        .from("attraction")
        .select(
          "attraction_id, attraction_name, attraction_city, attraction_countryregion, attraction_summary, attraction_vibe, attraction_normalizedrating, attraction_pricelevel"
        )
        .in("attraction_id", attractionIds)
        .limit(5000);

      if (attractionsResult.error) {
        res.status(500).json({ error: attractionsResult.error.message });
        return;
      }

      const [categoryLinksResult, imagesResult] = await Promise.all([
        supabase
          .from("attraction_categories")
          .select("attraction_id, category_id")
          .in("attraction_id", attractionIds)
          .limit(8000),
        supabase
          .from("images")
          .select("attraction_id, image_url")
          .in("attraction_id", attractionIds)
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
        new Set((categoryLinksResult.data ?? []).map((row) => Number(row.category_id)).filter(Number.isFinite))
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
      attractionIds.forEach((id, index) => positionById.set(id, index));

      const attractions = (attractionsResult.data ?? [])
        .map((row) => {
          const id = Number(row.attraction_id);
          const imageUrls = imageByAttraction.get(id) ?? [];

          return {
            id,
            name: normalizeText(row.attraction_name) || "Unnamed attraction",
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

      if (isExpired && results.length > 0) {
        const existingItineraryId = sessionResult.data.itinerary_id;
        if (existingItineraryId) {
          // Only return itineraryPath to the owner (logged-in user who created it)
          if (userId) {
            const itineraryResult = await supabase
              .from("itinerary")
              .select("user_id")
              .eq("itinerary_id", existingItineraryId)
              .limit(1)
              .maybeSingle<{ user_id: string | null }>();

            if (!itineraryResult.error && itineraryResult.data?.user_id === userId) {
              itineraryPath = `/saved-trips/${encodeURIComponent(existingItineraryId)}?fromCollab=1`;
            }
          }
        } else {
          const votedIds = results
            .filter((r) => r.yesVotes > r.noVotes)
            .sort((a, b) => b.yesVotes - b.noVotes - (a.yesVotes - a.noVotes))
            .map((r) => r.attractionId);

          if (votedIds.length > 0) {
            const itineraryId = crypto.randomUUID();
            const today = new Date();
            const startDate = today.toISOString().slice(0, 10);
            const endDate = new Date(today.getTime() + 1000 * 60 * 60 * 24).toISOString().slice(0, 10);

            // Store IDs only (normalized format), no full objects or slot
            const unscheduled = votedIds;

            const insertRow: Record<string, unknown> = {
              itinerary_id: itineraryId,
              trip_name: `Collab: ${place}`,
              place_id: placeId,
              start_date: startDate,
              end_date: endDate,
              pace: "balanced",
              notes: "",
              days: [],
              unscheduled
            };
            if (userId) insertRow.user_id = userId;

            const { error: insertErr } = await supabase.from("itinerary").insert(insertRow);

            if (!insertErr) {
              const updateSessionResult = await supabase
                .from("collab_session")
                .update({ itinerary_id: itineraryId })
                .eq("collab_session_id", sessionId);

              if (updateSessionResult.error && !isMissingColumnError(updateSessionResult.error.message)) {
                res.status(500).json({ error: updateSessionResult.error.message });
                return;
              }

              // Only return path to the creator (logged-in user who owns the itinerary)
              if (userId) {
                itineraryPath = `/saved-trips/${encodeURIComponent(itineraryId)}?fromCollab=1`;
              }
            }
          }
        }
      }

      res.status(200).json({ sessionId, placeId, place, attractions, isExpired, results, itineraryPath });
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
