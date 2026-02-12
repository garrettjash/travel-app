import { ChangeEvent, useEffect, useMemo, useState } from "react";

type Attraction = {
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

type Filters = {
  place: string;
  category: string;
  vibe: string;
  priceLevel: string;
  search: string;
};

type FilterOptions = {
  places: string[];
  categories: string[];
  vibes: string[];
  priceLevels: string[];
};

type ApiAttractionsResponse =
  | {
      data: Attraction[];
      totalCount: number;
      hasMore: boolean;
      limit: number;
      offset: number;
    }
  | { error: string };

type ApiFilterOptionsResponse =
  | { options: FilterOptions }
  | { error: string };

type AttractionsExplorerProps = {
  title: string;
  subtitle?: string;
};

const PAGE_SIZE = 6;

const defaultFilterOptions: FilterOptions = {
  places: [],
  categories: [],
  vibes: [],
  priceLevels: []
};

const defaultFilters: Filters = {
  place: "",
  category: "",
  vibe: "",
  priceLevel: "",
  search: ""
};

function formatLocation(city: string, country: string) {
  if (city && country) return `${city}, ${country}`;
  return city || country || "Location unavailable";
}

export default function AttractionsExplorer({ title, subtitle }: AttractionsExplorerProps) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [options, setOptions] = useState<FilterOptions>(defaultFilterOptions);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasMore = attractions.length < totalCount;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", PAGE_SIZE.toString());
    params.set("offset", "0");

    if (filters.place) params.set("place", filters.place);
    if (filters.category) params.set("category", filters.category);
    if (filters.vibe) params.set("vibe", filters.vibe);
    if (filters.priceLevel) params.set("priceLevel", filters.priceLevel);
    if (filters.search.trim()) params.set("search", filters.search.trim());

    return params.toString();
  }, [filters]);

  useEffect(() => {
    let isActive = true;

    async function loadFilterOptions() {
      try {
        const response = await fetch("/api/attractions?mode=filters");
        const payload = (await response.json()) as ApiFilterOptionsResponse;

        if (!isActive) return;

        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error : "Failed to load filters");
        }

        setOptions(payload.options);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : "Unknown error loading filters");
      }
    }

    loadFilterOptions();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    let isActive = true;

    async function loadInitialAttractions() {
      setIsLoading(true);
      setError(null);

      try {
        const response = await fetch(`/api/attractions?${queryParams}`);
        const payload = (await response.json()) as ApiAttractionsResponse;

        if (!isActive) return;

        if (!response.ok || "error" in payload) {
          throw new Error("error" in payload ? payload.error : "Failed to load attractions");
        }

        setAttractions(payload.data ?? []);
        setTotalCount(payload.totalCount ?? 0);
      } catch (err) {
        if (!isActive) return;
        setError(err instanceof Error ? err.message : "Unknown error loading attractions");
        setAttractions([]);
        setTotalCount(0);
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadInitialAttractions();

    return () => {
      isActive = false;
    };
  }, [queryParams]);

  const updateFilter = (key: keyof Filters) => (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const value = event.target.value;
    setFilters((current) => ({ ...current, [key]: value }));
  };

  async function handleViewMore() {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    setError(null);

    const params = new URLSearchParams();
    params.set("limit", PAGE_SIZE.toString());
    params.set("offset", attractions.length.toString());

    if (filters.place) params.set("place", filters.place);
    if (filters.category) params.set("category", filters.category);
    if (filters.vibe) params.set("vibe", filters.vibe);
    if (filters.priceLevel) params.set("priceLevel", filters.priceLevel);
    if (filters.search.trim()) params.set("search", filters.search.trim());

    try {
      const response = await fetch(`/api/attractions?${params.toString()}`);
      const payload = (await response.json()) as ApiAttractionsResponse;

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Failed to load more attractions");
      }

      setAttractions((current) => [...current, ...(payload.data ?? [])]);
      setTotalCount(payload.totalCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error loading more attractions");
    } finally {
      setIsLoadingMore(false);
    }
  }

  return (
    <>
      <header className="attractions-header">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </header>

      <section className="attractions-filters" aria-label="Attraction filters">
        <label className="attractions-filter-field">
          <span>Place</span>
          <select value={filters.place} onChange={updateFilter("place")}>
            <option value="">All places</option>
            {options.places.map((place) => (
              <option key={place} value={place}>
                {place}
              </option>
            ))}
          </select>
        </label>

        <label className="attractions-filter-field">
          <span>Category</span>
          <select value={filters.category} onChange={updateFilter("category")}>
            <option value="">All categories</option>
            {options.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>

        <label className="attractions-filter-field">
          <span>Vibe</span>
          <select value={filters.vibe} onChange={updateFilter("vibe")}>
            <option value="">All vibes</option>
            {options.vibes.map((vibe) => (
              <option key={vibe} value={vibe}>
                {vibe}
              </option>
            ))}
          </select>
        </label>

        <label className="attractions-filter-field">
          <span>Price Level</span>
          <select value={filters.priceLevel} onChange={updateFilter("priceLevel")}>
            <option value="">All price levels</option>
            {options.priceLevels.map((priceLevel) => (
              <option key={priceLevel} value={priceLevel}>
                {priceLevel}
              </option>
            ))}
          </select>
        </label>

        <label className="attractions-filter-field attractions-filter-search">
          <span>Search</span>
          <input
            type="text"
            value={filters.search}
            onChange={updateFilter("search")}
            placeholder="Search by attraction name"
          />
        </label>
      </section>

      <section className="attractions-results">
        {!isLoading && !error && (
          <p className="attractions-results-meta">
            Showing {attractions.length} of {totalCount} attractions
          </p>
        )}

        {isLoading && <p className="attractions-state">Loading attractions...</p>}
        {error && <p className="attractions-state attractions-state-error">Error: {error}</p>}

        {!isLoading && !error && attractions.length === 0 && (
          <p className="attractions-state">No attractions found for these filters.</p>
        )}

        {!isLoading && !error && attractions.length > 0 && (
          <>
            <div className="attractions-grid">
              {attractions.map((attraction) => (
                <article className="attraction-card" key={attraction.id}>
                  <div className="attraction-card-top">
                    <h2>{attraction.name}</h2>
                    <p>{formatLocation(attraction.city, attraction.country)}</p>
                  </div>

                  {attraction.categories.length > 0 && (
                    <p className="attraction-card-categories">
                      {attraction.categories.join(" • ")}
                    </p>
                  )}

                  {attraction.summary && <p className="attraction-card-summary">{attraction.summary}</p>}

                  <dl className="attraction-card-details">
                    <div>
                      <dt>Vibe</dt>
                      <dd>{attraction.vibe || "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Rating</dt>
                      <dd>{attraction.rating !== null ? attraction.rating.toFixed(2) : "N/A"}</dd>
                    </div>
                    <div>
                      <dt>Price</dt>
                      <dd>{attraction.priceLevel || "N/A"}</dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>

            {hasMore && (
              <div className="attractions-view-more-wrap">
                <button
                  type="button"
                  className="attractions-view-more"
                  onClick={handleViewMore}
                  disabled={isLoadingMore}
                >
                  {isLoadingMore ? "Loading..." : "View More"}
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </>
  );
}
