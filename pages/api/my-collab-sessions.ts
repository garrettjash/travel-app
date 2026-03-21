import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type CollabSessionItem = {
  sessionId: string;
  placeLabel: string;
  createdAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
  itineraryId: string;
  resultsPath: string;
  itineraryPath: string;
};

type MyCollabSessionsResponse =
  | { sessions: CollabSessionItem[] }
  | { error: string };

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function parseDurationFromSessionId(sessionId: string) {
  const match = sessionId.match(/_d(\d+)$/i);
  if (!match) return 1440;
  const parsed = Number(match[1]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1440;
}

function safeUserId(raw: unknown) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return null;
  return value;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MyCollabSessionsResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  const userId = safeUserId(req.query.userId);
  if (!userId) {
    res.status(400).json({ error: "Valid userId is required." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const itineraryResult = await supabase
      .from("itinerary")
      .select("itinerary_id")
      .eq("user_id", userId)
      .limit(5000);

    if (itineraryResult.error) {
      res.status(500).json({ error: itineraryResult.error.message });
      return;
    }

    const itineraryIds = (itineraryResult.data ?? [])
      .map((row: any) => String(row.itinerary_id || ""))
      .filter(Boolean);

    if (itineraryIds.length === 0) {
      res.status(200).json({ sessions: [] });
      return;
    }

    const sessionsResult = await supabase
      .from("collab_session")
      .select("collab_session_id, created_at, itinerary_id")
      .in("itinerary_id", itineraryIds)
      .order("created_at", { ascending: false })
      .limit(5000);

    if (sessionsResult.error) {
      res.status(500).json({ error: sessionsResult.error.message });
      return;
    }

    const rows = sessionsResult.data ?? [];
    const sessionIds = rows.map((row: any) => String(row.collab_session_id || "")).filter(Boolean);
    if (sessionIds.length === 0) {
      res.status(200).json({ sessions: [] });
      return;
    }
    const itineraryIdBySession = new Map<string, string>();
    for (const row of rows) {
      itineraryIdBySession.set(String(row.collab_session_id), String(row.itinerary_id));
    }

    const [placesResult, placeNamesResult, votesResult] = await Promise.all([
      supabase
        .from("collab_session_places")
        .select("session_id, place_id")
        .in("session_id", sessionIds)
        .limit(10000),
      supabase
        .from("place")
        .select("place_id, place_city, place_countryregion")
        .limit(10000),
      supabase
        .from("poll")
        .select("collab_session_id, vote")
        .in("collab_session_id", sessionIds)
        .limit(20000)
    ]);

    if (placesResult.error || placeNamesResult.error || votesResult.error) {
      const message =
        placesResult.error?.message || placeNamesResult.error?.message || votesResult.error?.message || "Load failed";
      res.status(500).json({ error: message });
      return;
    }

    const placeNameById = new Map<number, string>();
    for (const place of placeNamesResult.data ?? []) {
      const city = String((place as any).place_city ?? "").trim();
      const country = String((place as any).place_countryregion ?? "").trim();
      const label = city && country ? `${city}, ${country}` : city || country || "Unknown";
      placeNameById.set(Number((place as any).place_id), label);
    }

    const placeLabelsBySession = new Map<string, string[]>();
    for (const row of placesResult.data ?? []) {
      const sessionId = String((row as any).session_id ?? "");
      const placeId = Number((row as any).place_id);
      const label = placeNameById.get(placeId);
      if (!sessionId || !label) continue;
      const current = placeLabelsBySession.get(sessionId) ?? [];
      if (!current.includes(label)) current.push(label);
      placeLabelsBySession.set(sessionId, current);
    }

    const voteStatsBySession = new Map<string, { yesVotes: number; noVotes: number; totalVotes: number }>();
    for (const vote of votesResult.data ?? []) {
      const sessionId = String((vote as any).collab_session_id ?? "");
      if (!sessionId) continue;
      const current = voteStatsBySession.get(sessionId) ?? { yesVotes: 0, noVotes: 0, totalVotes: 0 };
      const value = (vote as any).vote;
      if (value === true) current.yesVotes += 1;
      if (value === false) current.noVotes += 1;
      current.totalVotes += 1;
      voteStatsBySession.set(sessionId, current);
    }

    const sessions: CollabSessionItem[] = rows.map((row: any) => {
      const sessionId = String(row.collab_session_id);
      const createdAt = row.created_at ? String(row.created_at) : null;
      const durationMinutes = parseDurationFromSessionId(sessionId);
      const expiresAtMs = createdAt ? Date.parse(createdAt) + durationMinutes * 60 * 1000 : NaN;
      const expiresAt = Number.isFinite(expiresAtMs) ? new Date(expiresAtMs).toISOString() : null;
      const isExpired = Number.isFinite(expiresAtMs) ? Date.now() > expiresAtMs : false;
      const voteStats = voteStatsBySession.get(sessionId) ?? { yesVotes: 0, noVotes: 0, totalVotes: 0 };
      const placeLabel = (placeLabelsBySession.get(sessionId) ?? []).join(" • ") || "Unknown destination";
      const itineraryId = itineraryIdBySession.get(sessionId) ?? "";
      return {
        sessionId,
        placeLabel,
        createdAt,
        expiresAt,
        isExpired,
        yesVotes: voteStats.yesVotes,
        noVotes: voteStats.noVotes,
        totalVotes: voteStats.totalVotes,
        itineraryId,
        resultsPath: `/collaborate/session?session=${encodeURIComponent(sessionId)}`,
        itineraryPath: `/solo-planner/${encodeURIComponent(itineraryId)}?fromCollab=1`
      };
    });

    res.status(200).json({ sessions });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
