import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type AttractionsResponse =
  | { data: Record<string, unknown>[] }
  | { error: string };

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AttractionsResponse>
) {
  if (!supabaseUrl || !supabaseAnonKey) {
    res.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  const limitParam = Array.isArray(req.query.limit)
    ? req.query.limit[0]
    : req.query.limit;
  const limit = Math.min(
    Math.max(Number(limitParam ?? 25), 1),
    100
  );

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data, error } = await supabase
    .from("attraction")
    .select("*")
    .limit(Number.isFinite(limit) ? limit : 25);

  if (error) {
    res.status(500).json({ error: error.message });
    return;
  }

  res.status(200).json({ data: data ?? [] });
}
