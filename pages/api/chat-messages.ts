import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type ChatMessage = {
  message_id: number | string;
  content: string;
  role: string | null;
  created_at: string | null;
};

type ChatMessagesResponse =
  | { data: ChatMessage[] }
  | { error: string };

// Use server-side env vars (not public)
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const chatTableName = "messages";

function getLimit(limitParam: string | string[] | undefined) {
  const value = Array.isArray(limitParam) ? limitParam[0] : limitParam;
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) return 50;
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChatMessagesResponse>
) {
  if (!supabaseUrl || !supabaseServiceKey) {
    res.status(500).json({ error: "Missing Supabase server env vars." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  try {
    if (req.method === "GET") {
      const limit = getLimit(req.query.limit);
      const { data, error } = await supabase
        .from(chatTableName)
        .select("message_id, content, role, created_at")
        .order("created_at", { ascending: true })
        .limit(limit);

      if (error) throw error;

      // Map message_id to id for consistency
      const mappedData = (data ?? []).map((m) => ({
        message_id: m.message_id,
        content: m.content,
        role: m.role,
        created_at: m.created_at,
      }));

      res.status(200).json({ data: mappedData });
      return;
    }

    if (req.method === "POST") {
      const contentInput =
        typeof req.body?.content === "string" ? req.body.content : "";
      const senderInput =
        typeof req.body?.sender === "string" ? req.body.sender : "user";
      const content = contentInput.trim();
      const sender = senderInput.trim() || "user";

      if (!content) {
        res.status(400).json({ error: "Message content is required." });
        return;
      }

      if (content.length > 2000) {
        res.status(400).json({ error: "Message content is too long." });
        return;
      }

      const { data, error } = await supabase
        .from(chatTableName)
        .insert({ content, sender })
        .select("message_id, content, sender, created_at")
        .single();

      if (error) throw error;

      res.status(201).json({
        data: [
          {
            message_id: data.message_id,
            content: data.content,
            role: data.sender,
            created_at: data.created_at,
          },
        ],
      });
      return;
    }

    res.setHeader("Allow", "GET, POST");
    res.status(405).json({ error: "Method Not Allowed" });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
