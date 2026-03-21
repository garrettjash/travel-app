import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Pace = "relaxed" | "balanced" | "packed";

type FavoriteAttraction = {
  id: number;
  name: string;
  city: string;
  stateProvince: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  distanceFromPlace: number | null;
  summary: string;
  vibe: string;
  rating: number | null;
  totalCountRatings: number | null;
  credibilityTier: number | null;
  reviewsSummary: string;
  priceLevel: string;
  popularityScore: number | null;
  rawData: string;
  lastRefreshed: string;
  categories: string[];
  imageUrl: string | null;
  imageUrls: string[];
};

type DayPlan = {
  dayNumber: number;
  stops: {
    attraction: FavoriteAttraction;
    startTime: string;
    durationMinutes: number;
  }[];
};

type DbStop = {
  attractionId: number;
  attractionName: string;
  startTime: string;
  durationMinutes: number;
};

type DbUnscheduledItem = {
  attractionId: number;
  attractionName: string;
  yesVotes?: number;
  noVotes?: number;
};

type DbDayPlan = {
  dayNumber: number;
  stops: DbStop[];
};

/** Stored in DB place column. Each entry: { placeId, placeName }. First = primary, rest = extra. */
type PlaceEntry = { placeId?: number; placeName: string };

/** For API response - matches PlaceOption / SavedTripBuilder shape */
type ExtraPlaceItem = {
  placeId?: number;
  label: string;
  city: string;
  countryRegion: string;
};

type ItineraryRow = {
  itinerary_id: string;
  trip_name: string | null;
  place?: unknown;
  share_code: string | null;
  share_code_required: boolean | null;
  start_date: string | null;
  end_date: string | null;
  // pace column has been removed from DB; keep field optional for backward-compat parsing
  pace?: string | null;
  notes: string | null;
  days: unknown;
  unscheduled: unknown;
  created_at: string | null;
  updated_at: string | null;
};

type ItineraryListItem = {
  itineraryId: string;
  tripName: string;
  location: string;
};

type SavedItineraryPayload = {
  itineraryId?: string;
  userId?: string;
  tripName: string;
  tripPlace?: string;
  placeId?: number;
  extraPlaces?: ExtraPlaceItem[];
  startDate: string;
  endDate: string;
  // pace is no longer persisted in DB
  pace?: Pace;
  notes: string;
  days: DayPlan[];
  unscheduled: FavoriteAttraction[];
};

type ItineraryResponse =
  | {
      itineraryId: string;
      path: string;
      shareCode?: string;
    }
  | { success: true }
  | {
      itinerary?: {
        itineraryId: string;
        tripName: string;
        tripPlace?: string;
        extraPlaces?: ExtraPlaceItem[];
        startDate: string;
        endDate: string;
        pace: Pace;
        notes: string;
        days: DayPlan[];
        unscheduled: FavoriteAttraction[];
        collabVoteStats?: Record<number, { yesVotes: number; noVotes: number }>;
        createdAt?: string;
        updatedAt?: string;
        requiresShareCode?: boolean;
        shareCode?: string;
      };
      itineraries?: ItineraryListItem[];
      error?: string;
    }
  | { error: string };

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function sanitizeItineraryId(rawValue: unknown) {
  const value = typeof rawValue === "string" ? rawValue : "";
  return value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
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

function generateItineraryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      // no-op, fall through to random fallback
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function generateShareCode() {
  const num = Math.floor(Math.random() * 1_000_000);
  return num.toString().padStart(6, "0");
}

/** Helpers copied from /api/attractions to hydrate FavoriteAttraction from the DB by ID */
type AttractionRow = {
  attraction_id: number;
  attraction_name: string | null;
  attraction_city: string | null;
  attraction_stateprovince: string | null;
  attraction_countryregion: string | null;
  attraction_latitude: number | null;
  attraction_longitude: number | null;
  attraction_distancefromplace: number | null;
  attraction_totalcountratings: number | null;
  attraction_credibilitytier: number | null;
  attraction_reviewssummary: string | null;
  attraction_rawdata: string | null;
  attraction_lastrefreshed: string | null;
  attraction_summary: string | null;
  attraction_vibe: string | null;
  attraction_normalizedrating: number | null;
  attraction_pricelevel: string | null;
  attraction_popularityscore: number | null;
};

type AttractionImageRow = {
  attraction_id: number;
  image_url: string | null;
};

const ATTRACTION_SELECT =
  "attraction_id, attraction_name, attraction_city, attraction_stateprovince, attraction_countryregion, attraction_latitude, attraction_longitude, attraction_distancefromplace, attraction_totalcountratings, attraction_credibilitytier, attraction_reviewssummary, attraction_rawdata, attraction_lastrefreshed, attraction_summary, attraction_vibe, attraction_normalizedrating, attraction_pricelevel, attraction_popularityscore";

function normalizeImageUrl(rawValue: string | null | undefined) {
  const value = normalizeText(rawValue);
  if (!value) return null;

  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;

  if (value.startsWith("s3://")) {
    const withoutScheme = value.slice(5);
    const firstSlashIndex = withoutScheme.indexOf("/");
    if (firstSlashIndex <= 0) return null;
    const bucket = withoutScheme.slice(0, firstSlashIndex);
    const key = withoutScheme.slice(firstSlashIndex + 1);
    return `https://${bucket}.s3.amazonaws.com/${key}`;
  }

  if (value.includes(".s3.amazonaws.com/") || value.includes(".s3.")) {
    return `https://${value}`;
  }

  return null;
}

function toDbShape(days: DayPlan[], unscheduled: FavoriteAttraction[]): {
  dbDays: DbDayPlan[];
  dbUnscheduled: DbUnscheduledItem[];
} {
  const dbDays: DbDayPlan[] = (days ?? []).map((day) => {
    const stops: DbStop[] = (day.stops ?? [])
      .map((stop) => {
        const attr = stop?.attraction;
        const id = attr?.id;
        if (!Number.isFinite(id)) return null;
        const name = typeof attr?.name === "string" ? attr.name.trim() || "Unnamed attraction" : "Unnamed attraction";
        const startTime =
          typeof (stop as any).startTime === "string" && /^\d{2}:\d{2}$/.test((stop as any).startTime)
            ? (stop as any).startTime
            : "09:00";
        const durationMinutes =
          typeof (stop as any).durationMinutes === "number" && (stop as any).durationMinutes > 0
            ? Math.round((stop as any).durationMinutes)
            : 90;
        return { attractionId: Number(id), attractionName: name, startTime, durationMinutes } as DbStop;
      })
      .filter((s): s is DbStop => Boolean(s));
    return { dayNumber: day.dayNumber, stops };
  });

  const seen = new Set<number>();
  const dbUnscheduled: DbUnscheduledItem[] = [];
  for (const item of unscheduled ?? []) {
    const id = item && (typeof item.id === "number" ? item.id : typeof (item as any).attractionId === "number" ? (item as any).attractionId : NaN);
    if (!Number.isFinite(id)) continue;
    const n = Number(id);
    if (seen.has(n)) continue;
    seen.add(n);
    const name =
      typeof item.name === "string" ? item.name.trim() || "Unnamed attraction"
      : typeof (item as any).attractionName === "string" ? String((item as any).attractionName).trim() || "Unnamed attraction"
      : "Unnamed attraction";
    dbUnscheduled.push({ attractionId: n, attractionName: name });
  }

  return { dbDays, dbUnscheduled };
}

function parseDurationFromSessionId(sessionId: string): number {
  const match = String(sessionId).match(/_d(\d+)$/i);
  if (!match) return 1440;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1440;
}

/** When fetching a collab itinerary with empty unscheduled, apply voted places from the linked session. */
async function applyCollabResultsIfNeeded(
  supabase: any,
  itineraryId: string,
  tripName: string | null,
  rawDays: unknown,
  rawUnscheduled: unknown,
  collabSessionIdFromQuery?: string | null
): Promise<{ rawDays: unknown; rawUnscheduled: unknown }> {
  const name = normalizeText(tripName) || "";
  if (!name.startsWith("Collab:")) return { rawDays, rawUnscheduled };

  const unsArr = Array.isArray(rawUnscheduled) ? (rawUnscheduled as any[]) : [];
  const daysArr = Array.isArray(rawDays) ? (rawDays as any[]) : [];
  const hasStopsInDays = daysArr.some((d) => Array.isArray(d?.stops) && d.stops.length > 0);
  if (unsArr.length > 0 || hasStopsInDays) return { rawDays, rawUnscheduled };

  let sessionId = "";
  let createdAtIso = "";

  const sanitizedCollabSession = collabSessionIdFromQuery
    ? String(collabSessionIdFromQuery).normalize("NFKC").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80)
    : "";
  if (sanitizedCollabSession) {
    const { data: directRow } = await supabase
      .from("collab_session")
      .select("collab_session_id, created_at, itinerary_id")
      .eq("collab_session_id", sanitizedCollabSession)
      .limit(1)
      .maybeSingle();
    const linkedItineraryId = directRow && (directRow as any).itinerary_id ? String((directRow as any).itinerary_id) : null;
    if (directRow && (!linkedItineraryId || linkedItineraryId === itineraryId)) {
      sessionId = String(directRow.collab_session_id || "");
      createdAtIso = normalizeText(directRow.created_at);
    }
  }

  if (!sessionId) {
    const { data: sessionRow, error: sessionErr } = await supabase
      .from("collab_session")
      .select("collab_session_id, created_at")
      .eq("itinerary_id", itineraryId)
      .limit(1)
      .maybeSingle();

    if (sessionErr) {
      if (/column.*itinerary_id.*does not exist/i.test(sessionErr.message)) {
        console.warn("[itinerary] collab_session.itinerary_id column missing - run migration 20250305000000");
      } else {
        console.error("[itinerary] collab session lookup failed:", sessionErr.message);
      }
      return { rawDays, rawUnscheduled };
    }
    if (!sessionRow) return { rawDays, rawUnscheduled };

    sessionId = String(sessionRow.collab_session_id || "");
    createdAtIso = normalizeText(sessionRow.created_at);
  }

  const createdAt = Date.parse(createdAtIso);
  if (!Number.isFinite(createdAt)) return { rawDays, rawUnscheduled };

  const durationMinutes = parseDurationFromSessionId(sessionId);
  const expiresAt = createdAt + durationMinutes * 60 * 1000;
  if (Date.now() <= expiresAt) return { rawDays, rawUnscheduled };

  const [pollRes, placesRes] = await Promise.all([
    supabase.from("poll").select("attraction_id, vote").eq("collab_session_id", sessionId).limit(10000),
    supabase.from("collab_session_places").select("place_id").eq("session_id", sessionId).limit(1000)
  ]);

  if (pollRes.error) return { rawDays, rawUnscheduled };

  let resolvedPlaceIds = (placesRes.data ?? []).map((r: any) => Number(r.place_id)).filter(Number.isFinite);
  if (resolvedPlaceIds.length === 0 && !placesRes.error) {
    const alt = await supabase
      .from("collab_session_places")
      .select("place_id")
      .eq("collab_session_id", sessionId)
      .limit(1000);
    resolvedPlaceIds = (alt.data ?? []).map((r: any) => Number(r.place_id)).filter(Number.isFinite);
  }

  const resultByAttraction = new Map<number, { yesVotes: number; noVotes: number }>();
  for (const row of pollRes.data ?? []) {
    const aid = Number(row.attraction_id);
    if (!Number.isFinite(aid)) continue;
    const cur = resultByAttraction.get(aid) ?? { yesVotes: 0, noVotes: 0 };
    if (row.vote === true) cur.yesVotes += 1;
    if (row.vote === false) cur.noVotes += 1;
    resultByAttraction.set(aid, cur);
  }

  const results = Array.from(resultByAttraction.entries())
    .filter(([, v]) => v.yesVotes > v.noVotes)
    .sort((a, b) => (b[1].yesVotes - b[1].noVotes) - (a[1].yesVotes - a[1].noVotes));

  if (results.length === 0) return { rawDays, rawUnscheduled };

  const attractionIds = results.map(([id]) => id);
  const attrQuery = supabase
    .from("attraction")
    .select("attraction_id, attraction_name")
    .in("attraction_id", attractionIds)
    .limit(5000);
  const { data: attrRows } =
    resolvedPlaceIds.length > 0
      ? await attrQuery.in("place_id", resolvedPlaceIds)
      : await attrQuery;

  const nameById = new Map<number, string>();
  for (const r of attrRows ?? []) {
    const id = Number(r.attraction_id);
    if (Number.isFinite(id)) nameById.set(id, normalizeText(r.attraction_name) || "Unnamed attraction");
  }

  const unscheduled = results.map(([attractionId]) => ({
    attractionId,
    attractionName: nameById.get(attractionId) ?? "Unnamed attraction",
    yesVotes: resultByAttraction.get(attractionId)!.yesVotes,
    noVotes: resultByAttraction.get(attractionId)!.noVotes
  }));

  const { error: updateErr } = await supabase
    .from("itinerary")
    .update({ days: [], unscheduled })
    .eq("itinerary_id", itineraryId);

  if (updateErr) {
    console.error("[itinerary] Failed to apply collab results:", updateErr.message);
    return { rawDays, rawUnscheduled };
  }

  return { rawDays: [], rawUnscheduled: unscheduled };
}

function collectAttractionIds(rawDays: unknown, rawUnscheduled: unknown): { ids: number[]; hasNormalizedIds: boolean } {
  const idsSet = new Set<number>();
  let hasNormalizedIds = false;

  const daysArray = Array.isArray(rawDays) ? (rawDays as any[]) : [];
  for (const day of daysArray) {
    const stops = Array.isArray(day?.stops) ? day.stops : [];
    for (const stop of stops) {
      const id = stop?.attractionId ?? stop?.attraction_id ?? (stop?.attraction && typeof stop.attraction.id === "number" ? stop.attraction.id : null);
      if (typeof id === "number" && Number.isFinite(id)) {
        hasNormalizedIds = true;
        idsSet.add(id);
      }
    }
  }

  const unsArray = Array.isArray(rawUnscheduled) ? (rawUnscheduled as any[]) : [];
  for (const item of unsArray) {
    if (typeof item === "number") {
      hasNormalizedIds = true;
      idsSet.add(item);
    } else if (item) {
      const id = item.attractionId ?? item.attraction_id ?? item.id;
      if (typeof id === "number" && Number.isFinite(id)) {
        hasNormalizedIds = true;
        idsSet.add(id);
      }
    }
  }

  return { ids: Array.from(idsSet), hasNormalizedIds };
}

async function hydrateAttractionsById(
  supabase: any,
  ids: number[]
): Promise<Map<number, FavoriteAttraction>> {
  const map = new Map<number, FavoriteAttraction>();
  if (ids.length === 0) return map;

  const uniqueIds = Array.from(new Set(ids));

  const { data, error } = await supabase
    .from("attraction")
    .select(ATTRACTION_SELECT)
    .in("attraction_id", uniqueIds)
    .limit(uniqueIds.length);

  if (error) {
    return map;
  }

  const attractionRows = (data ?? []) as unknown as AttractionRow[];
  const attractionIds = attractionRows.map((row) => row.attraction_id);

  let categoriesByAttraction = new Map<number, string[]>();
  let imageByAttraction = new Map<number, string[]>();

  if (attractionIds.length > 0) {
    const [linksResult, imagesResult] = await Promise.all([
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

    if (!linksResult.error && !imagesResult.error) {
      const linkRows = (linksResult.data ?? []) as {
        attraction_id: number;
        category_id: number;
      }[];
      const categoryIds = Array.from(
        new Set(linkRows.map((row) => Number(row.category_id)).filter(Number.isFinite))
      );

      const categoryNameById = new Map<number, string>();
      if (categoryIds.length > 0) {
        const categoriesResult = await supabase
          .from("category")
          .select("category_id, category_name")
          .in("category_id", categoryIds)
          .limit(2000);

        if (!categoriesResult.error) {
          const categoryRows = (categoriesResult.data ?? []) as {
            category_id: number;
            category_name: string | null;
          }[];
          for (const row of categoryRows) {
            categoryNameById.set(Number(row.category_id), normalizeText(row.category_name));
          }
        }
      }

      categoriesByAttraction = new Map<number, string[]>();
      for (const link of linkRows) {
        const attractionId = Number(link.attraction_id);
        const categoryName = categoryNameById.get(Number(link.category_id));
        if (!categoryName) continue;
        const current = categoriesByAttraction.get(attractionId) ?? [];
        if (!current.includes(categoryName)) {
          current.push(categoryName);
          categoriesByAttraction.set(attractionId, current);
        }
      }

      imageByAttraction = new Map<number, string[]>();
      for (const image of (imagesResult.data ?? []) as AttractionImageRow[]) {
        const attractionId = Number(image.attraction_id);
        const imageUrl = normalizeImageUrl(image.image_url);
        if (!imageUrl) continue;
        const current = imageByAttraction.get(attractionId) ?? [];
        if (!current.includes(imageUrl)) {
          current.push(imageUrl);
          imageByAttraction.set(attractionId, current);
        }
      }
    }
  }

  for (const row of attractionRows) {
    const id = row.attraction_id;
    const categories = categoriesByAttraction.get(id) ?? [];
    const imageUrls = imageByAttraction.get(id) ?? [];

    const favorite: FavoriteAttraction = {
      id,
      name: normalizeText(row.attraction_name) || "Unnamed attraction",
      city: normalizeText(row.attraction_city),
      stateProvince: normalizeText(row.attraction_stateprovince),
      country: normalizeText(row.attraction_countryregion),
      latitude:
        row.attraction_latitude !== null && Number.isFinite(Number(row.attraction_latitude))
          ? Number(row.attraction_latitude)
          : null,
      longitude:
        row.attraction_longitude !== null && Number.isFinite(Number(row.attraction_longitude))
          ? Number(row.attraction_longitude)
          : null,
      distanceFromPlace:
        row.attraction_distancefromplace !== null && Number.isFinite(Number(row.attraction_distancefromplace))
          ? Number(row.attraction_distancefromplace)
          : null,
      totalCountRatings:
        row.attraction_totalcountratings !== null && Number.isFinite(Number(row.attraction_totalcountratings))
          ? Number(row.attraction_totalcountratings)
          : null,
      credibilityTier:
        row.attraction_credibilitytier !== null && Number.isFinite(Number(row.attraction_credibilitytier))
          ? Number(row.attraction_credibilitytier)
          : null,
      reviewsSummary: normalizeText(row.attraction_reviewssummary),
      rawData: normalizeText(row.attraction_rawdata),
      lastRefreshed: normalizeText(row.attraction_lastrefreshed),
      summary: normalizeText(row.attraction_summary),
      vibe: normalizeText(row.attraction_vibe),
      rating:
        row.attraction_normalizedrating !== null && Number.isFinite(Number(row.attraction_normalizedrating))
          ? Number(row.attraction_normalizedrating)
          : null,
      priceLevel: normalizeText(row.attraction_pricelevel),
      popularityScore:
        row.attraction_popularityscore !== null && Number.isFinite(Number(row.attraction_popularityscore))
          ? Number(row.attraction_popularityscore)
          : null,
      categories,
      imageUrl: imageUrls[0] ?? null,
      imageUrls
    };

    map.set(id, favorite);
  }

  return map;
}

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse<ItineraryResponse>
) {
  if (!supabaseUrl || !supabaseKey) {
    response.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (request.method === "GET") {
      const rawUserId = request.query.userId;
      const userId =
        typeof rawUserId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
          ? rawUserId
          : null;

      const rawId = request.query.itineraryId;
      const itineraryId = sanitizeItineraryId(
        Array.isArray(rawId) ? rawId[0] : rawId ?? ""
      );

      // If no specific itineraryId, but we have a userId, return their list
      if (!itineraryId && userId) {
        const { data: rows, error } = await supabase
          .from("itinerary")
          .select("itinerary_id, trip_name, place")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        if (error) {
          response.status(500).json({ error: error.message });
          return;
        }

        const itineraries: ItineraryListItem[] = (rows ?? []).map((r) => {
          const tripName = normalizeText(r.trip_name) || "Untitled Trip";
          let location = "";
          const placeArr = Array.isArray(r.place) ? (r.place as PlaceEntry[]) : [];
          const primary = placeArr[0];
          if (primary && typeof primary.placeName === "string" && primary.placeName.trim()) {
            location = primary.placeName.trim();
          }
          return {
            itineraryId: r.itinerary_id,
            tripName,
            location
          };
        });

        response.status(200).json({ itineraries });
        return;
      }

      if (!itineraryId) {
        response.status(400).json({ error: "itineraryId or userId is required." });
        return;
      }

      const { data, error } = await supabase
        .from("itinerary")
        .select(
          "itinerary_id, trip_name, place, user_id, share_code, share_code_required, start_date, end_date, notes, days, unscheduled, created_at, updated_at"
        )
        .eq("itinerary_id", itineraryId)
        .limit(1)
        .maybeSingle<ItineraryRow>();

      if (error) {
        response.status(500).json({ error: error.message });
        return;
      }

      if (!data) {
        response.status(404).json({ error: "Itinerary not found." });
        return;
      }

      const shareCodeRequired = Boolean(data.share_code_required);
      const storedShareCode = data.share_code ?? null;
      const ownerId = (data as { user_id?: string | null }).user_id ?? null;
      const isOwner = Boolean(userId && ownerId && userId === ownerId);

      if (!isOwner && shareCodeRequired) {
        const rawShareCode = request.query.shareCode;
        const providedShareCode =
          typeof rawShareCode === "string" ? rawShareCode.trim() : "";
        if (!storedShareCode || !providedShareCode || providedShareCode !== storedShareCode) {
          response.status(403).json({ error: "Share code required" });
          return;
        }
      }

      const rawPlaceArr = Array.isArray(data.place)
        ? (data.place as any[])
        : typeof data.place === "object" && data.place !== null
        ? [data.place as any]
        : [];
      const placeArr: PlaceEntry[] = rawPlaceArr
        .filter((p) => p && (p.placeName || p.place_name))
        .map((p) => ({
          placeId: typeof (p.placeId ?? p.place_id) === "number" ? (p.placeId ?? p.place_id) : undefined,
          placeName: String(p.placeName ?? p.place_name ?? "").trim()
        }));
      const primaryPlace = placeArr[0];
      const tripPlace = primaryPlace?.placeName ?? "";

      let rawDays = (data.days ?? []) as unknown;
      let rawUnscheduled = (data.unscheduled ?? []) as unknown;

      console.log("[itinerary] raw from DB", {
        itineraryId,
        rawUnscheduledLength: Array.isArray(rawUnscheduled) ? (rawUnscheduled as any[]).length : 0,
        rawUnscheduledSample: Array.isArray(rawUnscheduled) ? (rawUnscheduled as any[])[0] : null,
        rawDaysLength: Array.isArray(rawDays) ? (rawDays as any[]).length : 0
      });

      const rawCollabSession = request.query.collabSession;
      const collabSessionFromQuery =
        typeof rawCollabSession === "string" ? rawCollabSession.trim() : Array.isArray(rawCollabSession) ? (rawCollabSession[0] ?? "").trim() : null;

      const applied = await applyCollabResultsIfNeeded(
        supabase,
        itineraryId,
        data.trip_name,
        rawDays,
        rawUnscheduled,
        collabSessionFromQuery || undefined
      );
      rawDays = applied.rawDays;
      rawUnscheduled = applied.rawUnscheduled;

      // Collect all attraction IDs referenced in days/unscheduled, supporting both legacy and new formats.
      const { ids, hasNormalizedIds } = collectAttractionIds(rawDays, rawUnscheduled);

      console.log("[itinerary] after collectAttractionIds", {
        itineraryId,
        ids,
        hasNormalizedIds,
        idsLength: ids.length
      });

      let hydratedDays: DayPlan[] = [];
      let hydratedUnscheduled: FavoriteAttraction[] = [];
      let collabVoteStats: Record<number, { yesVotes: number; noVotes: number }> = {};

      if (ids.length > 0 && hasNormalizedIds) {
        // New normalized shape (IDs only) — hydrate from DB.
        const byId = await hydrateAttractionsById(supabase, ids);

        const daysArray = Array.isArray(rawDays) ? (rawDays as any[]) : [];
        hydratedDays = daysArray.map((day): DayPlan => {
          const dayNumber = Number(day?.dayNumber) || 1;
          const stopsRaw = Array.isArray(day?.stops) ? day.stops : [];
          const stops: DayPlan["stops"] = [];
          for (const stop of stopsRaw) {
            const id =
              typeof stop?.attractionId === "number"
                ? stop.attractionId
                : typeof stop?.attraction_id === "number"
                ? stop.attraction_id
                : stop?.attraction && typeof stop.attraction.id === "number"
                ? stop.attraction.id
                : null;
            if (!Number.isFinite(id)) continue;
            const n = Number(id);
            const storedName = stop?.attractionName ?? stop?.attraction_name ?? stop?.attraction?.name;
            let attraction = byId.get(n);
            if (!attraction && typeof storedName === "string" && storedName.trim()) {
              attraction = {
                id: n,
                name: storedName.trim(),
                city: "",
                stateProvince: "",
                country: "",
                latitude: null,
                longitude: null,
                distanceFromPlace: null,
                summary: "",
                vibe: "",
                rating: null,
                totalCountRatings: null,
                credibilityTier: null,
                reviewsSummary: "",
                priceLevel: "",
                popularityScore: null,
                rawData: "",
                lastRefreshed: "",
                categories: [],
                imageUrl: null,
                imageUrls: []
              } as FavoriteAttraction;
            }
            if (!attraction) continue;
            let startTime =
              typeof stop?.startTime === "string" && /^\d{2}:\d{2}$/.test(stop.startTime)
                ? stop.startTime
                : "";
            if (!startTime && stop?.slot === "Afternoon") startTime = "14:00";
            else if (!startTime && stop?.slot === "Evening") startTime = "17:00";
            else if (!startTime) startTime = "09:00";
            const durationMinutes =
              typeof stop?.durationMinutes === "number" && stop.durationMinutes > 0
                ? Math.round(stop.durationMinutes)
                : 90;
            stops.push({ attraction, startTime, durationMinutes });
          }
          return { dayNumber, stops };
        });

        const usedInDays = new Set<number>();
        for (const day of hydratedDays) {
          for (const stop of day.stops) usedInDays.add(stop.attraction.id);
        }

        const unsArray = Array.isArray(rawUnscheduled) ? (rawUnscheduled as any[]) : [];
        const seenUnscheduled = new Set<number>();
        collabVoteStats = {};
        for (const item of unsArray) {
          const id = typeof item === "number" ? item : item?.attractionId ?? item?.attraction_id ?? item?.id;
          if (!Number.isFinite(id)) continue;
          const n = Number(id);
          if (usedInDays.has(n) || seenUnscheduled.has(n)) continue;
          const storedName = item?.attractionName ?? item?.attraction_name ?? item?.name;
          const yesVotes = typeof item?.yesVotes === "number" ? item.yesVotes : undefined;
          const noVotes = typeof item?.noVotes === "number" ? item.noVotes : undefined;
          if (yesVotes !== undefined && noVotes !== undefined) {
            collabVoteStats[n] = { yesVotes, noVotes };
          }
          let attraction = byId.get(n);
          if (attraction) {
            hydratedUnscheduled.push(attraction);
          } else if (typeof storedName === "string" && storedName.trim()) {
            // Fallback: attraction not in DB, use stored name as minimal display
            hydratedUnscheduled.push({
              id: n,
              name: storedName.trim(),
              city: "",
              stateProvince: "",
              country: "",
              latitude: null,
              longitude: null,
              distanceFromPlace: null,
              summary: "",
              vibe: "",
              rating: null,
              totalCountRatings: null,
              credibilityTier: null,
              reviewsSummary: "",
              priceLevel: "",
              popularityScore: null,
              rawData: "",
              lastRefreshed: "",
              categories: [],
              imageUrl: null,
              imageUrls: []
            } as FavoriteAttraction);
          }
          seenUnscheduled.add(n);
        }

        // Opportunistic in-place migration of legacy rows to IDs-only storage.
        if (!hasNormalizedIds) {
          const { dbDays, dbUnscheduled } = toDbShape(hydratedDays, hydratedUnscheduled);
          await supabase
            .from("itinerary")
            .update({ days: dbDays, unscheduled: dbUnscheduled })
            .eq("itinerary_id", itineraryId);
        }
      } else {
        // Legacy shape with full attraction objects (and possibly slot) — normalize to startTime/durationMinutes.
        const raw = (data.days ?? []) as any[];
        hydratedDays = raw.map((day): DayPlan => {
          const stops = (day.stops ?? []).map((stop: any) => {
            const slot = stop.slot || "Morning";
            const startTime =
              typeof stop.startTime === "string" && /^\d{2}:\d{2}$/.test(stop.startTime)
                ? stop.startTime
                : slot === "Afternoon"
                ? "14:00"
                : slot === "Evening"
                ? "17:00"
                : "09:00";
            const durationMinutes =
              typeof stop.durationMinutes === "number" && stop.durationMinutes > 0
                ? Math.round(stop.durationMinutes)
                : 90;
            return { attraction: stop.attraction, startTime, durationMinutes };
          });
          return { dayNumber: day.dayNumber ?? 1, stops };
        });
        hydratedUnscheduled = (data.unscheduled ?? []) as FavoriteAttraction[];
      }

      const extraPlaces: ExtraPlaceItem[] = placeArr.slice(1)
        .filter((p): p is PlaceEntry => p && typeof (p as PlaceEntry).placeName === "string")
        .map((p) => {
          const name = normalizeText((p as PlaceEntry).placeName) || "Unknown";
          const parts = name.split(",").map((s) => s.trim());
          const city = parts[0] ?? "";
          const countryRegion = parts.slice(1).join(", ").trim() || "";
          return {
            placeId: typeof (p as PlaceEntry).placeId === "number" ? (p as PlaceEntry).placeId : undefined,
            label: name,
            city,
            countryRegion
          };
        });

      const itinerary: {
        itineraryId: string;
        tripName: string;
        tripPlace?: string;
        extraPlaces?: ExtraPlaceItem[];
        startDate: string;
        endDate: string;
        pace: Pace;
        notes: string;
        days: DayPlan[];
        unscheduled: FavoriteAttraction[];
        collabVoteStats?: Record<number, { yesVotes: number; noVotes: number }>;
        createdAt?: string;
        updatedAt?: string;
        requiresShareCode?: boolean;
        shareCode?: string;
      } = {
        itineraryId: data.itinerary_id,
        tripName: normalizeText(data.trip_name) || "Untitled Trip",
        tripPlace: tripPlace || undefined,
        extraPlaces: extraPlaces.length > 0 ? extraPlaces : undefined,
        startDate: normalizeText(data.start_date) || "",
        endDate: normalizeText(data.end_date) || "",
        pace: "balanced",
        notes: normalizeText(data.notes),
        days: hydratedDays,
        unscheduled: hydratedUnscheduled,
        collabVoteStats: Object.keys(collabVoteStats).length > 0 ? collabVoteStats : undefined,
        createdAt: data.created_at ?? undefined,
        updatedAt: data.updated_at ?? undefined,
        requiresShareCode: Boolean(data.share_code_required)
      };

      if (isOwner && data.share_code) {
        itinerary.shareCode = data.share_code;
      }

      response.status(200).json({ itinerary });
      return;
    }

    if (request.method === "POST" || request.method === "PATCH") {
      const body = request.body as SavedItineraryPayload | undefined;
      if (!body) {
        response.status(400).json({ error: "Missing request body." });
        return;
      }

      const rawId = body.itineraryId;
      const incomingId = rawId ? sanitizeItineraryId(rawId) : "";
      const itineraryId = request.method === "POST" ? incomingId || generateItineraryId() : incomingId;

      if (!itineraryId) {
        response.status(400).json({ error: "itineraryId is required for updates." });
        return;
      }

      const tripName = normalizeText(body.tripName) || "Untitled Trip";
      const tripPlace = sanitizePlaceName(body.tripPlace);
      const startDate = normalizeText(body.startDate);
      const endDate = normalizeText(body.endDate);
      const pace = (normalizeText(body.pace) as Pace) || "balanced";
      const notes = normalizeText(body.notes);
      const days = Array.isArray(body.days) ? body.days : [];
      const unscheduled = Array.isArray(body.unscheduled) ? body.unscheduled : [];
      const rawExtraPlaces = Array.isArray(body.extraPlaces) ? body.extraPlaces : [];
      const extraPlaces: ExtraPlaceItem[] = rawExtraPlaces
        .filter((p) => p && typeof p.label === "string")
        .map((p) => ({
          placeId: typeof (p as any).placeId === "number" ? (p as any).placeId : typeof (p as any).id === "number" ? (p as any).id : undefined,
          label: normalizeText((p as any).label) || "Unknown",
          city: normalizeText((p as any).city) || "",
          countryRegion: normalizeText((p as any).countryRegion) || ""
        }));
      const rawUserId = body.userId;
      const userId =
        typeof rawUserId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
          ? rawUserId
          : null;

      const rawPlaceId = body.placeId;
      let primaryPlaceId: number | null =
        typeof rawPlaceId === "number" && Number.isFinite(rawPlaceId) && rawPlaceId > 0
          ? rawPlaceId
          : null;

      if (!primaryPlaceId && tripPlace) {
        const parts = tripPlace.split(",").map((s) => s.trim()).filter(Boolean);
        const cityPart = parts[0] ?? "";
        const countryPart = parts.slice(1).join(", ").trim() || "";
        let placeResult: { data?: { place_id: number } | null; error: unknown } | null = null;

        if (cityPart && countryPart) {
          placeResult = await supabase
            .from("place")
            .select("place_id")
            .ilike("place_city", cityPart)
            .ilike("place_countryregion", countryPart)
            .limit(1)
            .maybeSingle();
        }
        if ((!placeResult?.data || placeResult.error) && cityPart) {
          placeResult = await supabase
            .from("place")
            .select("place_id")
            .ilike("place_city", cityPart)
            .limit(1)
            .maybeSingle();
        }
        if ((!placeResult?.data || placeResult.error) && tripPlace) {
          const safe = tripPlace.replace(/\\/g, "\\\\").replace(/\*/g, "\\*");
          placeResult = await supabase
            .from("place")
            .select("place_id")
            .or(`place_city.ilike.*${safe}*,place_countryregion.ilike.*${safe}*`)
            .limit(1)
            .maybeSingle();
        }
        if (!placeResult?.error && placeResult?.data) {
          const id = Number(placeResult.data.place_id);
          if (Number.isFinite(id) && id > 0) primaryPlaceId = id;
        }
      }

      const placeEntries: PlaceEntry[] = [];
      if (tripPlace.trim()) {
        placeEntries.push({
          placeId: primaryPlaceId ?? undefined,
          placeName: tripPlace.trim()
        });
      }
      for (const ep of extraPlaces) {
        const label = ep.label?.trim();
        if (label) {
          placeEntries.push({
            placeId: ep.placeId ?? undefined,
            placeName: label
          });
        }
      }

      if (!startDate || !endDate) {
        response.status(400).json({ error: "startDate and endDate are required." });
        return;
      }

      if (request.method === "POST") {
        const shareCode = generateShareCode();
        const { dbDays, dbUnscheduled } = toDbShape(days, unscheduled);
        const insertRow: Record<string, unknown> = {
          itinerary_id: itineraryId,
          trip_name: tripName,
          place: placeEntries,
          start_date: startDate,
          end_date: endDate,
          notes,
          days: dbDays,
          unscheduled: dbUnscheduled,
          share_code: shareCode,
          share_code_required: true
        };
        if (userId) insertRow.user_id = userId;
        const { error } = await supabase.from("itinerary").insert(insertRow);

        if (error) {
          const isDuplicate = error.code === "23505";
          response.status(isDuplicate ? 409 : 500).json({ error: error.message });
          return;
        }

        response.status(201).json({
          itineraryId,
          path: `/solo-planner/${encodeURIComponent(itineraryId)}`,
          shareCode
        });
        return;
      }

      if (request.method === "PATCH") {
        let { dbDays, dbUnscheduled } = toDbShape(days, unscheduled);
        const { data: existing } = await supabase
          .from("itinerary")
          .select("unscheduled")
          .eq("itinerary_id", itineraryId)
          .maybeSingle();
        const existingUnscheduled = Array.isArray((existing as any)?.unscheduled) ? (existing as any).unscheduled : [];
        const voteStatsByAttraction: Record<number, { yesVotes: number; noVotes: number }> = {};
        for (const item of existingUnscheduled) {
          const id = item?.attractionId ?? item?.id;
          if (Number.isFinite(id) && typeof item?.yesVotes === "number" && typeof item?.noVotes === "number") {
            voteStatsByAttraction[Number(id)] = { yesVotes: item.yesVotes, noVotes: item.noVotes };
          }
        }
        if (Object.keys(voteStatsByAttraction).length > 0) {
          dbUnscheduled = dbUnscheduled.map((u) => {
            const stats = voteStatsByAttraction[u.attractionId];
            return stats ? { ...u, yesVotes: stats.yesVotes, noVotes: stats.noVotes } : u;
          });
        }
        const { error } = await supabase
          .from("itinerary")
          .update({
            trip_name: tripName,
            place: placeEntries,
            start_date: startDate,
            end_date: endDate,
            notes,
            days: dbDays,
            unscheduled: dbUnscheduled
          })
          .eq("itinerary_id", itineraryId);

        if (error) {
          response.status(500).json({ error: error.message });
          return;
        }

        response.status(200).json({
          itineraryId,
          path: `/solo-planner/${encodeURIComponent(itineraryId)}`
        });
        return;
      }
    }

    if (request.method === "DELETE") {
      const rawUserId = request.query.userId;
      const userId =
        typeof rawUserId === "string" &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
          ? rawUserId
          : null;

      const rawId = request.query.itineraryId;
      const itineraryId = sanitizeItineraryId(
        Array.isArray(rawId) ? rawId[0] : rawId ?? ""
      );

      if (!itineraryId || !userId) {
        response.status(400).json({ error: "itineraryId and userId are required." });
        return;
      }

      const { data, error: fetchErr } = await supabase
        .from("itinerary")
        .select("user_id")
        .eq("itinerary_id", itineraryId)
        .limit(1)
        .maybeSingle<{ user_id: string | null }>();

      if (fetchErr) {
        response.status(500).json({ error: fetchErr.message });
        return;
      }

      if (!data) {
        response.status(404).json({ error: "Itinerary not found." });
        return;
      }

      if (data.user_id !== userId) {
        response.status(403).json({ error: "You can only delete your own itineraries." });
        return;
      }

      const { error: deleteErr } = await supabase
        .from("itinerary")
        .delete()
        .eq("itinerary_id", itineraryId);

      if (deleteErr) {
        response.status(500).json({ error: deleteErr.message });
        return;
      }

      response.status(200).json({ success: true });
      return;
    }

    response.setHeader("Allow", "GET, POST, PATCH, DELETE");
    response.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    response.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error"
    });
  }
}

