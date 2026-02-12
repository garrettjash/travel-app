import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type Message = {
  message_id: number;
  role: "user" | "assistant";
  content: string;
  created_at: string;
};

type MessagesResponse = {
  data?: Message[];
  error?: string;
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<MessagesResponse>
) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ error: "Method Not Allowed" });
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseKey) {
    return res.status(500).json({ error: "Missing Supabase credentials" });
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    const { data, error } = await supabase
      .from("messages")
      .select("message_id, role, content, created_at")
      .order("created_at", { ascending: true });

    if (error) throw error;

    res.status(200).json({ data: data || [] });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Unknown error" });
  }
}
