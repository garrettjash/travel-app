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
    slot: "Morning" | "Afternoon" | "Evening";
  }[];
};

type ItineraryRow = {
  itinerary_id: string;
  trip_name: string | null;
  place_id: number | null;
  share_code: string | null;
  share_code_required: boolean | null;
  start_date: string | null;
  end_date: string | null;
  pace: string | null;
  notes: string | null;
  days: DayPlan[] | null;
  unscheduled: FavoriteAttraction[] | null;
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
  startDate: string;
  endDate: string;
  pace: Pace;
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
  | {
      itinerary?: {
        itineraryId: string;
        tripName: string;
        startDate: string;
        endDate: string;
        pace: Pace;
        notes: string;
        days: DayPlan[];
        unscheduled: FavoriteAttraction[];
        createdAt?: string;
        updatedAt?: string;
        requiresShareCode?: boolean;
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
          .select("itinerary_id, trip_name, place_id")
          .eq("user_id", userId)
          .order("updated_at", { ascending: false });

        if (error) {
          response.status(500).json({ error: error.message });
          return;
        }

        const placeIds = [...new Set((rows ?? []).map((r) => r.place_id).filter(Boolean))];
        let placeMap: Record<number, { city: string; country: string }> = {};
        if (placeIds.length > 0) {
          const { data: places } = await supabase
            .from("place")
            .select("place_id, place_city, place_countryregion")
            .in("place_id", placeIds);
          for (const p of places ?? []) {
            const id = Number(p.place_id);
            placeMap[id] = {
              city: normalizeText(p.place_city) || "",
              country: normalizeText(p.place_countryregion) || ""
            };
          }
        }

        const itineraries: ItineraryListItem[] = (rows ?? []).map((r) => {
          const tripName = normalizeText(r.trip_name) || "Untitled Trip";
          let location = "";
          if (r.place_id && placeMap[r.place_id]) {
            const { city, country } = placeMap[r.place_id];
            location = city && country ? `${city}, ${country}` : city || country;
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
          "itinerary_id, trip_name, place_id, user_id, share_code, share_code_required, start_date, end_date, pace, notes, days, unscheduled, created_at, updated_at"
        )
        .eq("itinerary_id", itineraryId)
        .limit(1)
        .maybeSingle<ItineraryRow & { place_id?: number | null }>();

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

      let tripPlace = "";
      const rawPlaceId = (data as { place_id?: number | null }).place_id;
      if (rawPlaceId && Number.isFinite(Number(rawPlaceId))) {
        const placeRes = await supabase
          .from("place")
          .select("place_city, place_countryregion")
          .eq("place_id", rawPlaceId)
          .maybeSingle();
        if (!placeRes.error && placeRes.data) {
          const city = normalizeText(placeRes.data.place_city) || "";
          const country = normalizeText(placeRes.data.place_countryregion) || "";
          tripPlace = city && country ? `${city}, ${country}` : city || country;
        }
      }

      const itinerary = {
        itineraryId: data.itinerary_id,
        tripName: normalizeText(data.trip_name) || "Untitled Trip",
        tripPlace: tripPlace || undefined,
        startDate: normalizeText(data.start_date) || "",
        endDate: normalizeText(data.end_date) || "",
        pace: (normalizeText(data.pace) as Pace) || "balanced",
        notes: normalizeText(data.notes),
        days: (data.days ?? []) as DayPlan[],
        unscheduled: (data.unscheduled ?? []) as FavoriteAttraction[],
        createdAt: data.created_at ?? undefined,
        updatedAt: data.updated_at ?? undefined,
        requiresShareCode: Boolean(data.share_code_required)
      };

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
      const rawUserId = body.userId;
      const userId =
        typeof rawUserId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawUserId)
          ? rawUserId
          : null;

      const rawPlaceId = body.placeId;
      const providedPlaceId =
        typeof rawPlaceId === "number" && Number.isFinite(rawPlaceId) && rawPlaceId > 0
          ? rawPlaceId
          : null;

      let placeId: number | null = null;
      if (providedPlaceId) {
        const check = await supabase
          .from("place")
          .select("place_id")
          .eq("place_id", providedPlaceId)
          .maybeSingle();
        if (!check.error && check.data) {
          placeId = providedPlaceId;
        }
      }
      if (!placeId && tripPlace) {
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
          if (Number.isFinite(id) && id > 0) placeId = id;
        }
      }

      if (!startDate || !endDate) {
        response.status(400).json({ error: "startDate and endDate are required." });
        return;
      }

      if (request.method === "POST") {
        const shareCode = generateShareCode();
        const insertRow: Record<string, unknown> = {
          itinerary_id: itineraryId,
          trip_name: tripName,
          place_id: placeId,
          start_date: startDate,
          end_date: endDate,
          pace,
          notes,
          days,
          unscheduled,
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
          path: `/saved-trips/${encodeURIComponent(itineraryId)}`,
          shareCode
        });
        return;
      }

      if (request.method === "PATCH") {
        // For updates, enforce share code for anonymous users when required
        const existing = await supabase
          .from("itinerary")
          .select("user_id, share_code, share_code_required")
          .eq("itinerary_id", itineraryId)
          .maybeSingle<{ user_id: string | null; share_code: string | null; share_code_required: boolean | null }>();

        if (existing.error) {
          response.status(500).json({ error: existing.error.message });
          return;
        }

        const ownerId = existing.data?.user_id ?? null;
        const shareCodeRequired = Boolean(existing.data?.share_code_required);
        const storedShareCode = existing.data?.share_code ?? null;

        const isOwner = userId && ownerId && userId === ownerId;

        if (!isOwner && shareCodeRequired) {
          const providedShareCode =
            typeof (body as any).shareCode === "string" ? (body as any).shareCode.trim() : "";
          if (!storedShareCode || providedShareCode !== storedShareCode) {
            response.status(403).json({ error: "Invalid or missing share code for editing." });
            return;
          }
        }

        const { error } = await supabase
          .from("itinerary")
          .update({
            trip_name: tripName,
            place_id: placeId,
            start_date: startDate,
            end_date: endDate,
            pace,
            notes,
            days,
            unscheduled
          })
          .eq("itinerary_id", itineraryId);

        if (error) {
          response.status(500).json({ error: error.message });
          return;
        }

        response.status(200).json({
          itineraryId,
          path: `/saved-trips/${encodeURIComponent(itineraryId)}`
        });
        return;
      }
    }

    response.setHeader("Allow", "GET, POST, PATCH");
    response.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    response.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error"
    });
  }
}

