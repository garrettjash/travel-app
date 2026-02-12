import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type ChatMessage = {
  id: number | string;
  content: string;
  sender: string | null;
  created_at: string | null;
};

type ChatMessagesResponse =
  | { data: ChatMessage[] }
  | { error: string };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const chatTableName =
  process.env.CHAT_MESSAGES_TABLE ||
  process.env.NEXT_PUBLIC_CHAT_MESSAGES_TABLE ||
  "chat_messages";

function getLimit(limitParam: string | string[] | undefined) {
  const value = Array.isArray(limitParam) ? limitParam[0] : limitParam;
  const parsed = Number(value ?? 50);
  if (!Number.isFinite(parsed)) {
    return 50;
  }
  return Math.min(Math.max(Math.floor(parsed), 1), 100);
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<ChatMessagesResponse>
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);

  if (req.method === "GET") {
    const limit = getLimit(req.query.limit);
    const { data, error } = await supabase
      .from(chatTableName)
      .select("id, content, sender, created_at")
      .order("created_at", { ascending: true })
      .limit(limit);

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(200).json({ data: (data ?? []) as ChatMessage[] });
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
      .select("id, content, sender, created_at")
      .single();

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    res.status(201).json({ data: data ? [data as ChatMessage] : [] });
    return;
  }

  res.setHeader("Allow", "GET, POST");
  res.status(405).json({ error: "Method Not Allowed" });
}
