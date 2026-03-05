import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type VoteResponse =
  | { votes: Record<number, "up" | "down"> }
  | { success: true }
  | { error: string };

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function sanitizeSessionId(rawValue: unknown) {
  const value = typeof rawValue === "string" ? rawValue : "";
  return value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function sanitizeGuestId(rawValue: unknown) {
  const value = typeof rawValue === "string" ? rawValue : "";
  return value
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9-]/g, "")
    .slice(0, 80);
}

function asString(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<VoteResponse>
) {
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    if (req.method === "GET") {
      const sessionId = sanitizeSessionId(asString(req.query.sessionId));
      const guestId = sanitizeGuestId(asString(req.query.guestId));

      if (!sessionId || !guestId) {
        res.status(400).json({ error: "sessionId and guestId are required." });
        return;
      }

      const result = await supabase
        .from("poll")
        .select("attraction_id, vote")
        .eq("collab_session_id", sessionId)
        .eq("guest_id", guestId)
        .limit(5000);

      if (result.error) {
        res.status(500).json({ error: result.error.message });
        return;
      }

      const votes: Record<number, "up" | "down"> = {};
      for (const row of result.data ?? []) {
        const attractionId = Number(row.attraction_id);
        if (!Number.isFinite(attractionId)) continue;
        votes[attractionId] = row.vote ? "up" : "down";
      }

      res.status(200).json({ votes });
      return;
    }

    if (req.method === "POST") {
      const sessionId = sanitizeSessionId(req.body?.sessionId);
      const guestId = sanitizeGuestId(req.body?.guestId);
      const attractionId = Number(req.body?.attractionId);
      const vote = req.body?.vote;

      if (!sessionId || !guestId || !Number.isFinite(attractionId) || typeof vote !== "boolean") {
        res.status(400).json({ error: "Invalid vote payload." });
        return;
      }

      const insertResult = await supabase.from("poll").insert({
        collab_session_id: sessionId,
        guest_id: guestId,
        attraction_id: attractionId,
        vote
      });

      if (insertResult.error) {
        if (insertResult.error.code === "23505") {
          res.status(409).json({ error: "Vote already exists for this attraction." });
          return;
        }

        res.status(500).json({ error: insertResult.error.message });
        return;
      }

      res.status(201).json({ success: true });
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
