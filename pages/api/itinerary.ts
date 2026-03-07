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
  start_date: string | null;
  end_date: string | null;
  pace: string | null;
  notes: string | null;
  days: DayPlan[] | null;
  unscheduled: FavoriteAttraction[] | null;
  created_at: string | null;
  updated_at: string | null;
};

type SavedItineraryPayload = {
  itineraryId?: string;
  userId?: string;
  tripName: string;
  tripPlace?: string;
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
      };
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
      const rawId = request.query.itineraryId;
      const itineraryId = sanitizeItineraryId(
        Array.isArray(rawId) ? rawId[0] : rawId ?? ""
      );

      if (!itineraryId) {
        response.status(400).json({ error: "itineraryId is required." });
        return;
      }

      const { data, error } = await supabase
        .from("itinerary")
        .select(
          "itinerary_id, trip_name, start_date, end_date, pace, notes, days, unscheduled, created_at, updated_at"
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

      const itinerary = {
        itineraryId: data.itinerary_id,
        tripName: normalizeText(data.trip_name) || "Untitled Trip",
        startDate: normalizeText(data.start_date) || "",
        endDate: normalizeText(data.end_date) || "",
        pace: (normalizeText(data.pace) as Pace) || "balanced",
        notes: normalizeText(data.notes),
        days: (data.days ?? []) as DayPlan[],
        unscheduled: (data.unscheduled ?? []) as FavoriteAttraction[],
        createdAt: data.created_at ?? undefined,
        updatedAt: data.updated_at ?? undefined
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

      let placeId: number | null = null;
      if (tripPlace) {
        const placeQuery = supabase
          .from("place")
          .select("place_id, place_city, place_countryregion")
          .limit(1);

        const placeResult = await placeQuery
          .or(`place_city.ilike.${tripPlace},place_countryregion.ilike.${tripPlace}`)
          .maybeSingle();

        if (!placeResult.error && placeResult.data) {
          const rawPlaceId = Number(placeResult.data.place_id);
          if (Number.isFinite(rawPlaceId) && rawPlaceId > 0) {
            placeId = rawPlaceId;
          }
        }
      }

      if (!startDate || !endDate) {
        response.status(400).json({ error: "startDate and endDate are required." });
        return;
      }

      if (request.method === "POST") {
        const insertRow: Record<string, unknown> = {
          itinerary_id: itineraryId,
          trip_name: tripName,
          place_id: placeId,
          start_date: startDate,
          end_date: endDate,
          pace,
          notes,
          days,
          unscheduled
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
          path: `/saved-trips/${encodeURIComponent(itineraryId)}`
        });
        return;
      }

      if (request.method === "PATCH") {
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

