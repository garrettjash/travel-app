import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type PlaceOption = {
  id: number;
  label: string;
  city: string;
  countryRegion: string;
};

type PlacesResponse =
  | {
      options: PlaceOption[];
    }
  | {
      error: string;
    };

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<PlacesResponse>
) {
  if (!supabaseUrl || !supabaseKey) {
    res.status(500).json({ error: "Missing Supabase env vars." });
    return;
  }

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ error: "Method Not Allowed" });
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  const rawSearch = req.query.search;
  const search =
    typeof rawSearch === "string" ? rawSearch.trim().slice(0, 100) : "";

  try {
    let query = supabase
      .from("place")
      .select("place_id, place_city, place_countryregion");

    if (search) {
      const escaped = search.replace(/[%_\\]/g, "\\$&").replace(/"/g, '\\"');
      const pattern = `"%${escaped}%"`;
      query = query.or(
        `place_city.ilike.${pattern},place_stateprovince.ilike.${pattern},place_countryregion.ilike.${pattern}`
      );
    }

    const result = await query.limit(search ? 50 : 5000);

    if (result.error) {
      res.status(500).json({ error: result.error.message });
      return;
    }

    const options = (result.data ?? [])
      .map((row) => {
        const id = Number(row.place_id);
        const city = normalizeText(row.place_city);
        const country = normalizeText(row.place_countryregion);
        const label = city || country;

        if (!Number.isFinite(id) || !label) return null;

        return {
          id,
          label: city && country ? `${city}, ${country}` : label,
          city,
          countryRegion: country
        } as PlaceOption;
      })
      .filter((item): item is PlaceOption => Boolean(item))
      .sort((left, right) => left.label.localeCompare(right.label));

    res.status(200).json({ options });
  } catch (error) {
    res.status(500).json({
      error: error instanceof Error ? error.message : "Unknown error"
    });
  }
}
