import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type ChatMessage = {
  message_id: number | string;
  content: string;
  role: string | null;
  session_id: string | null;
  created_at: string | null;
};

type ChatMessagesResponse =
  | { data: ChatMessage[] }
  | { error: string };

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  throw new Error("Missing Supabase server env vars.");
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

function getLimit(limitParam: string | string[] | undefined) {
  const value = Array.isArray(limitParam) ? limitParam[0] : limitParam;
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

export default async function handler(
  request: NextApiRequest,
  response: NextApiResponse<ChatMessagesResponse>
) {
  try {
    if (request.method === "GET") {
      const limit = getLimit(request.query.limit);
      const sessionIdParam = request.query.session_id;
      const sessionId = Array.isArray(sessionIdParam) ? sessionIdParam[0] : sessionIdParam;

      let query = supabase
        .from("messages")
        .select("message_id, content, role, session_id, created_at")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (sessionId?.trim()) {
        query = query.eq("session_id", sessionId.trim());
      }

      const { data, error } = await query;

      if (error) throw error;

      return response.status(200).json({ data: data ?? [] });
    }

    if (request.method === "POST") {
      const content = request.body?.content?.trim() ?? "";
      const sender = request.body?.sender?.trim() ?? "user";
      const sessionId = request.body?.session_id?.trim() ?? "";

      if (!content) {
        response.status(400).json({ error: "Message content is required." });
        return;
      }

      if (content.length > 2000) {
        response.status(400).json({ error: "Message content is too long." });
        return;
      }

      if (!sessionId) {
        response.status(400).json({ error: "Session ID is required." });
        return;
      }

      const { data, error } = await supabase
        .from("messages")
        .insert({ content, sender, session_id: sessionId })
        .select("message_id, content, role, session_id, created_at")
        .single();

      if (error) throw error;

      return response.status(201).json({ data: [data] });
    }

    response.setHeader("Allow", "GET, POST");
    response.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    return response.status(500).json({
      error: err instanceof Error ? err.message : "Unknown error"
    });
  }
}
