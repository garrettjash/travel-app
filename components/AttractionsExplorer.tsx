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
  country: string;
  minRating: string;
  minPopularity: string;
};

type FilterOptions = {
  places: string[];
  countries: string[];
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
  initialPlace?: string;
};

const PAGE_SIZE = 6;

const defaultFilterOptions: FilterOptions = {
  places: [],
  countries: [],
  categories: [],
  vibes: [],
  priceLevels: []
};

const defaultFilters: Filters = {
  place: "",
  category: "",
  vibe: "",
  priceLevel: "",
  search: "",
  country: "",
  minRating: "",
  minPopularity: ""
};

const defaultVisibleFilters: FilterKey[] = [
  "place",
  "category",
  "vibe",
  "priceLevel",
  "search"
];

type FilterKey = keyof Filters;

const filterLabels: Record<FilterKey, string> = {
  place: "Place",
  category: "Category",
  vibe: "Vibe",
  priceLevel: "Price Level",
  search: "Search",
  country: "Country",
  minRating: "Min Rating",
  minPopularity: "Min Popularity"
};

function formatLocation(city: string, country: string) {
  if (city && country) return `${city}, ${country}`;
  return city || country || "Location unavailable";
}

function formatCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

export default function AttractionsExplorer({ title, subtitle, initialPlace }: AttractionsExplorerProps) {
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [visibleFilters, setVisibleFilters] = useState<FilterKey[]>(defaultVisibleFilters);
  const [selectedFilterToAdd, setSelectedFilterToAdd] = useState<FilterKey | "">("");
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
    if (filters.country) params.set("country", filters.country);
    if (filters.minRating.trim()) params.set("minRating", filters.minRating.trim());
    if (filters.minPopularity.trim()) params.set("minPopularity", filters.minPopularity.trim());

    return params.toString();
  }, [filters]);

  useEffect(() => {
    if (initialPlace === undefined) return;

    const normalized = initialPlace.trim();
    setFilters((current) => {
      if (current.place === normalized) return current;
      return { ...current, place: normalized };
    });
  }, [initialPlace]);

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
    if (filters.country) params.set("country", filters.country);
    if (filters.minRating.trim()) params.set("minRating", filters.minRating.trim());
    if (filters.minPopularity.trim()) params.set("minPopularity", filters.minPopularity.trim());

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

  const availableFiltersToAdd = (Object.keys(filterLabels) as FilterKey[]).filter(
    (key) => !visibleFilters.includes(key)
  );

  const handleRemoveFilter = (key: FilterKey) => {
    setVisibleFilters((current) => current.filter((item) => item !== key));
    setFilters((current) => ({ ...current, [key]: "" }));
  };

  const handleAddFilter = () => {
    if (!selectedFilterToAdd) return;
    setVisibleFilters((current) => [...current, selectedFilterToAdd]);
    setSelectedFilterToAdd("");
  };

  const renderFilterField = (key: FilterKey) => {
    const canRemove = true;

    if (key === "place") {
      return (
        <label className="attractions-filter-field" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <select value={filters.place} onChange={updateFilter("place")}>
            <option value="">All places</option>
            {filters.place && !options.places.includes(filters.place) && (
              <option value={filters.place}>{filters.place}</option>
            )}
            {options.places.map((place) => (
              <option key={place} value={place}>
                {place}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "category") {
      return (
        <label className="attractions-filter-field" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <select value={filters.category} onChange={updateFilter("category")}>
            <option value="">All categories</option>
            {options.categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "vibe") {
      return (
        <label className="attractions-filter-field" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <select value={filters.vibe} onChange={updateFilter("vibe")}>
            <option value="">All vibes</option>
            {options.vibes.map((vibe) => (
              <option key={vibe} value={vibe}>
                {vibe}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "priceLevel") {
      return (
        <label className="attractions-filter-field" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <select value={filters.priceLevel} onChange={updateFilter("priceLevel")}>
            <option value="">All price levels</option>
            {options.priceLevels.map((priceLevel) => (
              <option key={priceLevel} value={priceLevel}>
                {priceLevel}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "search") {
      return (
        <label className="attractions-filter-field attractions-filter-search" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <input
            type="text"
            value={filters.search}
            onChange={updateFilter("search")}
            placeholder="Search by attraction name"
          />
        </label>
      );
    }

    if (key === "country") {
      return (
        <label className="attractions-filter-field" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <select value={filters.country} onChange={updateFilter("country")}>
            <option value="">All countries</option>
            {options.countries.map((country) => (
              <option key={country} value={country}>
                {country}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "minRating") {
      return (
        <label className="attractions-filter-field" key={key}>
          <div className="attractions-filter-head">
            <span>{filterLabels[key]}</span>
            {canRemove && (
              <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
                -
              </button>
            )}
          </div>
          <input
            type="number"
            min={0}
            max={10}
            step={0.1}
            value={filters.minRating}
            onChange={updateFilter("minRating")}
            placeholder="0.0 - 10.0"
          />
        </label>
      );
    }

    return (
      <label className="attractions-filter-field" key={key}>
        <div className="attractions-filter-head">
          <span>{filterLabels[key]}</span>
          {canRemove && (
            <button type="button" onClick={() => handleRemoveFilter(key)} className="attractions-filter-remove">
              -
            </button>
          )}
        </div>
        <input
          type="number"
          min={0}
          step={1}
          value={filters.minPopularity}
          onChange={updateFilter("minPopularity")}
          placeholder="Minimum popularity"
        />
      </label>
    );
  };

  return (
    <>
      <header className="attractions-header">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </header>

      <section className="attractions-filters" aria-label="Attraction filters">
        {visibleFilters.map(renderFilterField)}

        <div className="attractions-filter-add">
          <span>Add More Filters</span>
          <div className="attractions-filter-add-row">
            <select
              value={selectedFilterToAdd}
              onChange={(event) => setSelectedFilterToAdd(event.target.value as FilterKey | "")}
              disabled={availableFiltersToAdd.length === 0}
            >
              <option value="">
                {availableFiltersToAdd.length === 0 ? "All filters already shown" : "Select a filter"}
              </option>
              {availableFiltersToAdd.map((key) => (
                <option key={key} value={key}>
                  {filterLabels[key]}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="attractions-filter-add-button"
              onClick={handleAddFilter}
              disabled={!selectedFilterToAdd}
            >
              Add
            </button>
          </div>
        </div>
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
                      <dd>{attraction.vibe ? formatCommaList(attraction.vibe) : "N/A"}</dd>
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
