import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type AttractionRow = {
  attraction_id: number;
  attraction_name: string | null;
  attraction_city: string | null;
  attraction_countryregion: string | null;
  attraction_summary: string | null;
  attraction_vibe: string | null;
  attraction_normalizedrating: number | null;
  attraction_pricelevel: string | null;
  attraction_popularityscore: number | null;
};

type AttractionItem = {
  id: number;
  name: string;
  city: string;
  country: string;
  summary: string;
  vibe: string;
  rating: number | null;
  priceLevel: string;
  popularityScore: number | null;
  categories: string[];
};

type FilterOptionsResponse = {
  places: string[];
  categories: string[];
  vibes: string[];
  priceLevels: string[];
};

type AttractionsResponse =
  | {
      data: AttractionItem[];
      totalCount: number;
      hasMore: boolean;
      limit: number;
      offset: number;
    }
  | { options: FilterOptionsResponse }
  | { error: string };

const supabaseUrl =
  process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const DEFAULT_PAGE_SIZE = 6;
const MAX_PAGE_SIZE = 24;
const ATTRACTION_SELECT =
  "attraction_id, attraction_name, attraction_city, attraction_countryregion, attraction_summary, attraction_vibe, attraction_normalizedrating, attraction_pricelevel, attraction_popularityscore";

function asString(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  return (raw ?? "").trim();
}

function asLimit(value: string | string[] | undefined) {
  const raw = Number(asString(value) || DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(raw)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.floor(raw), 1), MAX_PAGE_SIZE);
}

function asOffset(value: string | string[] | undefined) {
  const raw = Number(asString(value) || 0);
  if (!Number.isFinite(raw)) return 0;
  return Math.max(Math.floor(raw), 0);
}

function normalizeText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function uniqueSorted(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(values.map((value) => normalizeText(value)).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse<AttractionsResponse>
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

  try {
    const mode = asString(req.query.mode);
    if (mode === "filters") {
      const [attractionFilterResult, categoryResult] = await Promise.all([
        supabase
          .from("attraction")
          .select("attraction_city, attraction_countryregion, attraction_vibe, attraction_pricelevel")
          .limit(2000),
        supabase.from("category").select("category_name").limit(500)
      ]);

      if (attractionFilterResult.error) {
        res.status(500).json({ error: attractionFilterResult.error.message });
        return;
      }

      if (categoryResult.error) {
        res.status(500).json({ error: categoryResult.error.message });
        return;
      }

      const places = uniqueSorted(
        (attractionFilterResult.data ?? []).map((row) => {
          const city = normalizeText(row.attraction_city);
          const country = normalizeText(row.attraction_countryregion);
          if (city && country) return `${city}, ${country}`;
          return city || country;
        })
      );

      const vibes = uniqueSorted(
        (attractionFilterResult.data ?? []).map((row) => row.attraction_vibe)
      );

      const priceLevels = uniqueSorted(
        (attractionFilterResult.data ?? []).map((row) => row.attraction_pricelevel)
      );

      const categories = uniqueSorted(
        (categoryResult.data ?? []).map((row) => row.category_name)
      );

      res.status(200).json({
        options: {
          places,
          categories,
          vibes,
          priceLevels
        }
      });
      return;
    }

    const limit = asLimit(req.query.limit);
    const offset = asOffset(req.query.offset);
    const place = asString(req.query.place);
    const category = asString(req.query.category);
    const vibe = asString(req.query.vibe);
    const priceLevel = asString(req.query.priceLevel);
    const search = asString(req.query.search);

    let categoryFilteredIds: number[] | null = null;

    if (category) {
      const categoryMatch = await supabase
        .from("category")
        .select("category_id")
        .ilike("category_name", category)
        .maybeSingle();

      if (categoryMatch.error) {
        res.status(500).json({ error: categoryMatch.error.message });
        return;
      }

      if (!categoryMatch.data?.category_id) {
        res.status(200).json({ data: [], totalCount: 0, hasMore: false, limit, offset });
        return;
      }

      const linksResult = await supabase
        .from("attraction_categories")
        .select("attraction_id")
        .eq("category_id", categoryMatch.data.category_id)
        .limit(5000);

      if (linksResult.error) {
        res.status(500).json({ error: linksResult.error.message });
        return;
      }

      categoryFilteredIds = Array.from(
        new Set((linksResult.data ?? []).map((row) => Number(row.attraction_id)).filter(Number.isFinite))
      );

      if (categoryFilteredIds.length === 0) {
        res.status(200).json({ data: [], totalCount: 0, hasMore: false, limit, offset });
        return;
      }
    }

    let query = supabase
      .from("attraction")
      .select(ATTRACTION_SELECT, { count: "exact" })
      .order("attraction_popularityscore", { ascending: false, nullsFirst: false })
      .range(offset, offset + limit - 1);

    if (categoryFilteredIds) {
      query = query.in("attraction_id", categoryFilteredIds);
    }

    if (place) {
      if (place.includes(",")) {
        const [cityPart, ...countryParts] = place.split(",");
        const city = cityPart.trim();
        const country = countryParts.join(",").trim();
        if (city) query = query.ilike("attraction_city", city);
        if (country) query = query.ilike("attraction_countryregion", country);
      } else {
        query = query.or(
          `attraction_city.ilike.${place},attraction_countryregion.ilike.${place}`
        );
      }
    }

    if (vibe) {
      query = query.ilike("attraction_vibe", vibe);
    }

    if (priceLevel) {
      query = query.eq("attraction_pricelevel", priceLevel);
    }

    if (search) {
      query = query.ilike("attraction_name", `%${search}%`);
    }

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const attractionRows = (data ?? []) as unknown as AttractionRow[];
    const attractionIds = attractionRows.map((row) => row.attraction_id);

    let categoriesByAttraction = new Map<number, string[]>();

    if (attractionIds.length > 0) {
      const linksResult = await supabase
        .from("attraction_categories")
        .select("attraction_id, category_id")
        .in("attraction_id", attractionIds)
        .limit(8000);

      if (linksResult.error) {
        res.status(500).json({ error: linksResult.error.message });
        return;
      }

      const categoryIds = Array.from(
        new Set((linksResult.data ?? []).map((row) => Number(row.category_id)).filter(Number.isFinite))
      );

      const categoryNameById = new Map<number, string>();

      if (categoryIds.length > 0) {
        const categoriesResult = await supabase
          .from("category")
          .select("category_id, category_name")
          .in("category_id", categoryIds)
          .limit(2000);

        if (categoriesResult.error) {
          res.status(500).json({ error: categoriesResult.error.message });
          return;
        }

        for (const row of categoriesResult.data ?? []) {
          categoryNameById.set(Number(row.category_id), normalizeText(row.category_name));
        }
      }

      categoriesByAttraction = new Map<number, string[]>();
      for (const link of linksResult.data ?? []) {
        const attractionId = Number(link.attraction_id);
        const categoryName = categoryNameById.get(Number(link.category_id));
        if (!categoryName) continue;
        const current = categoriesByAttraction.get(attractionId) ?? [];
        if (!current.includes(categoryName)) {
          current.push(categoryName);
          categoriesByAttraction.set(attractionId, current);
        }
      }
    }

    const items: AttractionItem[] = attractionRows.map((row) => ({
      id: row.attraction_id,
      name: normalizeText(row.attraction_name) || "Unnamed attraction",
      city: normalizeText(row.attraction_city),
      country: normalizeText(row.attraction_countryregion),
      summary: normalizeText(row.attraction_summary),
      vibe: normalizeText(row.attraction_vibe),
      rating:
        row.attraction_normalizedrating !== null && Number.isFinite(Number(row.attraction_normalizedrating))
          ? Number(row.attraction_normalizedrating)
          : null,
      priceLevel: normalizeText(row.attraction_pricelevel),
      popularityScore:
        row.attraction_popularityscore !== null && Number.isFinite(Number(row.attraction_popularityscore))
          ? Number(row.attraction_popularityscore)
          : null,
      categories: categoriesByAttraction.get(row.attraction_id) ?? []
    }));

    const totalCount = Number(count ?? items.length);

    res.status(200).json({
      data: items,
      totalCount,
      hasMore: offset + items.length < totalCount,
      limit,
      offset
    });
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Unknown attractions API error"
    });
  }
}
