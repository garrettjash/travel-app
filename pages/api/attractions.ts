import type { NextApiRequest, NextApiResponse } from "next";
import { createClient } from "@supabase/supabase-js";

type AttractionRow = {
  attraction_id: number;
  attraction_name: string | null;
  attraction_city: string | null;
  attraction_stateprovince: string | null;
  attraction_countryregion: string | null;
  attraction_latitude: number | null;
  attraction_longitude: number | null;
  attraction_distancefromplace: number | null;
  attraction_totalcountratings: number | null;
  attraction_credibilitytier: number | null;
  attraction_reviewssummary: string | null;
  attraction_rawdata: string | null;
  attraction_lastrefreshed: string | null;
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
  stateProvince: string;
  country: string;
  summary: string;
  vibe: string;
  rating: number | null;
  totalCountRatings: number | null;
  credibilityTier: number | null;
  reviewsSummary: string;
  priceLevel: string;
  popularityScore: number | null;
  latitude: number | null;
  longitude: number | null;
  distanceFromPlace: number | null;
  rawData: string;
  lastRefreshed: string;
  categories: string[];
  imageUrl: string | null;
  imageUrls: string[];
};

type AttractionImageRow = {
  attraction_id: number;
  image_url: string | null;
};

type FilterOptionsResponse = {
  cities: string[];
  stateProvinces: string[];
  countryRegions: string[];
  categories: string[];
  vibes: string[];
  priceLevels: string[];
};

type AttractionsResponse =
  | {
      data: AttractionItem[];
      totalCount: number;
      totalDatabaseCount: number;
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
const SUPABASE_PAGE_BATCH = 1000;
const ATTRACTION_SELECT =
  "attraction_id, attraction_name, attraction_city, attraction_stateprovince, attraction_countryregion, attraction_latitude, attraction_longitude, attraction_distancefromplace, attraction_totalcountratings, attraction_credibilitytier, attraction_reviewssummary, attraction_rawdata, attraction_lastrefreshed, attraction_summary, attraction_vibe, attraction_normalizedrating, attraction_pricelevel, attraction_popularityscore";

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

function asNumber(value: string | string[] | undefined) {
  const parsed = asString(value);
  if (!parsed) return null;
  const raw = Number(parsed);
  if (!Number.isFinite(raw)) return null;
  return raw;
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

function escapeForIlike(value: string) {
  return value.replace(/[%_]/g, "\\$&");
}

function normalizeImageUrl(rawValue: string | null | undefined) {
  const value = normalizeText(rawValue);
  if (!value) return null;

  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  if (value.startsWith("//")) return `https:${value}`;

  if (value.startsWith("s3://")) {
    const withoutScheme = value.slice(5);
    const firstSlashIndex = withoutScheme.indexOf("/");
    if (firstSlashIndex <= 0) return null;
    const bucket = withoutScheme.slice(0, firstSlashIndex);
    const key = withoutScheme.slice(firstSlashIndex + 1);
    return `https://${bucket}.s3.amazonaws.com/${key}`;
  }

  if (value.includes(".s3.amazonaws.com/") || value.includes(".s3.")) {
    return `https://${value}`;
  }

  return null;
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
      const attractionFilterRows: Array<{
        attraction_city: string | null;
        attraction_stateprovince: string | null;
        attraction_countryregion: string | null;
        attraction_vibe: string | null;
        attraction_pricelevel: string | null;
      }> = [];

      for (let from = 0; ; from += SUPABASE_PAGE_BATCH) {
        const to = from + SUPABASE_PAGE_BATCH - 1;
        const { data, error } = await supabase
          .from("attraction")
          .select("attraction_city, attraction_stateprovince, attraction_countryregion, attraction_vibe, attraction_pricelevel")
          .range(from, to);

        if (error) {
          res.status(500).json({ error: error.message });
          return;
        }

        const page = data ?? [];
        attractionFilterRows.push(...page);
        if (page.length < SUPABASE_PAGE_BATCH) break;
      }

      const categoryResult = await supabase.from("category").select("category_name").limit(5000);

      if (categoryResult.error) {
        res.status(500).json({ error: categoryResult.error.message });
        return;
      }

      const cities = uniqueSorted(
        attractionFilterRows.map((row) => row.attraction_city)
      );

      const stateProvinces = uniqueSorted(
        attractionFilterRows.map((row) => row.attraction_stateprovince)
      );

      const countryRegions = uniqueSorted(
        attractionFilterRows.map((row) => row.attraction_countryregion)
      );

      const vibes = uniqueSorted(
        attractionFilterRows.map((row) => row.attraction_vibe)
      );

      const priceLevels = uniqueSorted(
        attractionFilterRows.map((row) => row.attraction_pricelevel)
      );

      const categories = uniqueSorted(
        (categoryResult.data ?? []).map((row) => row.category_name)
      );

      res.status(200).json({
        options: {
          cities,
          stateProvinces,
          countryRegions,
          categories,
          vibes,
          priceLevels
        }
      });
      return;
    }

    const limit = asLimit(req.query.limit);
    const offset = asOffset(req.query.offset);
    const city = asString(req.query.city);
    const stateProvince = asString(req.query.stateProvince);
    const countryRegion = asString(req.query.countryRegion);
    const category = asString(req.query.category);
    const vibe = asString(req.query.vibe);
    const priceLevel = asString(req.query.priceLevel);
    const search = asString(req.query.search);
    const minRating = asNumber(req.query.minRating);
    const minPopularity = asNumber(req.query.minPopularity);
    const totalDatabaseResult = await supabase
      .from("attraction")
      .select("attraction_id", { count: "exact", head: true });

    if (totalDatabaseResult.error) {
      res.status(500).json({ error: totalDatabaseResult.error.message });
      return;
    }

    const totalDatabaseCount = Number(totalDatabaseResult.count ?? 0);

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
        res.status(200).json({ data: [], totalCount: 0, totalDatabaseCount, hasMore: false, limit, offset });
        return;
      }

      const ids = new Set<number>();
      for (let from = 0; ; from += SUPABASE_PAGE_BATCH) {
        const to = from + SUPABASE_PAGE_BATCH - 1;
        const { data: page, error: linksError } = await supabase
          .from("attraction_categories")
          .select("attraction_id")
          .eq("category_id", categoryMatch.data.category_id)
          .range(from, to);

        if (linksError) {
          res.status(500).json({ error: linksError.message });
          return;
        }

        const linkRows = page ?? [];
        for (const row of linkRows) {
          const id = Number(row.attraction_id);
          if (Number.isFinite(id)) ids.add(id);
        }
        if (linkRows.length < SUPABASE_PAGE_BATCH) break;
      }

      categoryFilteredIds = Array.from(ids);

      if (categoryFilteredIds.length === 0) {
        res.status(200).json({ data: [], totalCount: 0, totalDatabaseCount, hasMore: false, limit, offset });
        return;
      }
    }

    let query = supabase
      .from("attraction")
      .select(ATTRACTION_SELECT, { count: "exact" })
      .order("attraction_popularityscore", { ascending: false, nullsFirst: false })
      .order("attraction_id", { ascending: true })
      .range(offset, offset + limit - 1);

    if (categoryFilteredIds) {
      query = query.in("attraction_id", categoryFilteredIds);
    }

    if (city) {
      query = query.ilike("attraction_city", `%${city}%`);
    }

    if (stateProvince) {
      query = query.ilike("attraction_stateprovince", `%${stateProvince}%`);
    }

    if (vibe) {
      query = query.ilike("attraction_vibe", vibe);
    }

    if (countryRegion) {
      query = query.ilike("attraction_countryregion", `%${countryRegion}%`);
    }

    if (priceLevel) {
      query = query.eq("attraction_pricelevel", priceLevel);
    }

    if (minRating !== null) {
      query = query.gte("attraction_normalizedrating", minRating);
    }

    if (minPopularity !== null) {
      query = query.gte("attraction_popularityscore", minPopularity);
    }

    if (search) {
      const searchValue = escapeForIlike(search);
      query = query.or(
        [
          `attraction_name.ilike.%${searchValue}%`,
          `attraction_city.ilike.%${searchValue}%`,
          `attraction_stateprovince.ilike.%${searchValue}%`,
          `attraction_countryregion.ilike.%${searchValue}%`,
          `attraction_summary.ilike.%${searchValue}%`
        ].join(",")
      );
    }

    const { data, error, count } = await query;

    if (error) {
      res.status(500).json({ error: error.message });
      return;
    }

    const attractionRows = (data ?? []) as unknown as AttractionRow[];
    const attractionIds = attractionRows.map((row) => row.attraction_id);

    let categoriesByAttraction = new Map<number, string[]>();
    let imageByAttraction = new Map<number, string[]>();

    if (attractionIds.length > 0) {
      const [linksResult, imagesResult] = await Promise.all([
        supabase
          .from("attraction_categories")
          .select("attraction_id, category_id")
          .in("attraction_id", attractionIds)
          .limit(8000),
        supabase
          .from("images")
          .select("attraction_id, image_url")
          .in("attraction_id", attractionIds)
          .limit(8000)
      ]);

      if (linksResult.error) {
        res.status(500).json({ error: linksResult.error.message });
        return;
      }

      if (imagesResult.error) {
        res.status(500).json({ error: imagesResult.error.message });
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

      imageByAttraction = new Map<number, string[]>();
      for (const image of (imagesResult.data ?? []) as AttractionImageRow[]) {
        const attractionId = Number(image.attraction_id);
        const imageUrl = normalizeImageUrl(image.image_url);
        if (!imageUrl) continue;
        const current = imageByAttraction.get(attractionId) ?? [];
        if (!current.includes(imageUrl)) {
          current.push(imageUrl);
          imageByAttraction.set(attractionId, current);
        }
      }
    }

    const items: AttractionItem[] = attractionRows.map((row) => ({
      id: row.attraction_id,
      name: normalizeText(row.attraction_name) || "Unnamed attraction",
      city: normalizeText(row.attraction_city),
      stateProvince: normalizeText(row.attraction_stateprovince),
      country: normalizeText(row.attraction_countryregion),
      latitude:
        row.attraction_latitude !== null && Number.isFinite(Number(row.attraction_latitude))
          ? Number(row.attraction_latitude)
          : null,
      longitude:
        row.attraction_longitude !== null && Number.isFinite(Number(row.attraction_longitude))
          ? Number(row.attraction_longitude)
          : null,
      distanceFromPlace:
        row.attraction_distancefromplace !== null && Number.isFinite(Number(row.attraction_distancefromplace))
          ? Number(row.attraction_distancefromplace)
          : null,
      totalCountRatings:
        row.attraction_totalcountratings !== null && Number.isFinite(Number(row.attraction_totalcountratings))
          ? Number(row.attraction_totalcountratings)
          : null,
      credibilityTier:
        row.attraction_credibilitytier !== null && Number.isFinite(Number(row.attraction_credibilitytier))
          ? Number(row.attraction_credibilitytier)
          : null,
      reviewsSummary: normalizeText(row.attraction_reviewssummary),
      rawData: normalizeText(row.attraction_rawdata),
      lastRefreshed: normalizeText(row.attraction_lastrefreshed),
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
      categories: categoriesByAttraction.get(row.attraction_id) ?? [],
      imageUrl: (imageByAttraction.get(row.attraction_id) ?? [])[0] ?? null,
      imageUrls: imageByAttraction.get(row.attraction_id) ?? []
    }));

    const totalCount = Number(count ?? items.length);

    res.status(200).json({
      data: items,
      totalCount,
      totalDatabaseCount,
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
