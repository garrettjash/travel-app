import { ChangeEvent, useEffect, useMemo, useState } from "react";
import AttractionDetailsModal from "./AttractionDetailsModal";
import { FavoriteAttraction, useFavorites } from "../lib/favorites-context";
import { useItinerary } from "../lib/itinerary-context";

type Attraction = {
  id: number;
  name: string;
  city: string;
  stateProvince: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  distanceFromPlace: number | null;
  summary: string;
  vibe: string;
  rating: number | null;
  totalCountRatings: number | null;
  credibilityTier: number | null;
  reviewsSummary: string;
  priceLevel: string;
  popularityScore: number | null;
  rawData: string;
  lastRefreshed: string;
  categories: string[];
  imageUrl: string | null;
  imageUrls: string[];
};

type Filters = {
  city: string;
  stateProvince: string;
  countryRegion: string;
  category: string;
  vibe: string;
  priceLevel: string;
  search: string;
  minRating: string;
  minPopularity: string;
};

type FilterOptions = {
  cities: string[];
  stateProvinces: string[];
  countryRegions: string[];
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
  cities: [],
  stateProvinces: [],
  countryRegions: [],
  categories: [],
  vibes: [],
  priceLevels: []
};

const defaultFilters: Filters = {
  city: "",
  stateProvince: "",
  countryRegion: "",
  category: "",
  vibe: "",
  priceLevel: "",
  search: "",
  minRating: "",
  minPopularity: ""
};

const defaultVisibleFilters: FilterKey[] = [
  "city",
  "stateProvince",
  "countryRegion",
  "category"
];

type FilterKey = keyof Filters;

const filterLabels: Record<FilterKey, string> = {
  city: "City",
  stateProvince: "State",
  countryRegion: "Country",
  category: "Category",
  vibe: "Vibe",
  priceLevel: "Price Level",
  search: "Search",
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

function dedupeAttractionsById(list: Attraction[]) {
  const seen = new Set<number>();
  const deduped: Attraction[] = [];
  for (const item of list) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    deduped.push(item);
  }
  return deduped;
}

export default function AttractionsExplorer({ title, subtitle, initialPlace }: AttractionsExplorerProps) {
  const { toggleFavorite, isFavorite } = useFavorites();
  const { addAttraction } = useItinerary();
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [visibleFilters, setVisibleFilters] = useState<FilterKey[]>(defaultVisibleFilters);
  const [selectedFilterToAdd, setSelectedFilterToAdd] = useState<FilterKey | "">("");
  const [options, setOptions] = useState<FilterOptions>(defaultFilterOptions);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [imageIndexByAttraction, setImageIndexByAttraction] = useState<Record<number, number>>({});
  const [selectedAttraction, setSelectedAttraction] = useState<Attraction | null>(null);

  const hasMore = attractions.length < totalCount;

  const queryParams = useMemo(() => {
    const params = new URLSearchParams();
    params.set("limit", PAGE_SIZE.toString());
    params.set("offset", "0");

    if (filters.city) params.set("city", filters.city);
    if (filters.stateProvince) params.set("stateProvince", filters.stateProvince);
    if (filters.countryRegion) params.set("countryRegion", filters.countryRegion);
    if (filters.category) params.set("category", filters.category);
    if (filters.vibe) params.set("vibe", filters.vibe);
    if (filters.priceLevel) params.set("priceLevel", filters.priceLevel);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.minRating.trim()) params.set("minRating", filters.minRating.trim());
    if (filters.minPopularity.trim()) params.set("minPopularity", filters.minPopularity.trim());

    return params.toString();
  }, [filters]);

  useEffect(() => {
    if (initialPlace === undefined) return;

    const normalized = initialPlace.trim();
    setFilters((current) => {
      if (!normalized || current.search === normalized) return current;
      return { ...current, search: normalized };
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

        setAttractions(dedupeAttractionsById(payload.data ?? []));
        setTotalCount(payload.totalCount ?? 0);
        setImageIndexByAttraction({});
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

    if (filters.city) params.set("city", filters.city);
    if (filters.stateProvince) params.set("stateProvince", filters.stateProvince);
    if (filters.countryRegion) params.set("countryRegion", filters.countryRegion);
    if (filters.category) params.set("category", filters.category);
    if (filters.vibe) params.set("vibe", filters.vibe);
    if (filters.priceLevel) params.set("priceLevel", filters.priceLevel);
    if (filters.search.trim()) params.set("search", filters.search.trim());
    if (filters.minRating.trim()) params.set("minRating", filters.minRating.trim());
    if (filters.minPopularity.trim()) params.set("minPopularity", filters.minPopularity.trim());

    try {
      const response = await fetch(`/api/attractions?${params.toString()}`);
      const payload = (await response.json()) as ApiAttractionsResponse;

      if (!response.ok || "error" in payload) {
        throw new Error("error" in payload ? payload.error : "Failed to load more attractions");
      }

      setAttractions((current) => dedupeAttractionsById([...current, ...(payload.data ?? [])]));
      setTotalCount(payload.totalCount ?? 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error loading more attractions");
    } finally {
      setIsLoadingMore(false);
    }
  }

  const availableFiltersToAdd = (Object.keys(filterLabels) as FilterKey[]).filter(
    (key) => key !== "search" && !visibleFilters.includes(key)
  );

  const handleRemoveFilter = (key: FilterKey) => {
    setVisibleFilters((current) => current.filter((item) => item !== key));
    setFilters((current) => ({ ...current, [key]: "" }));
  };

  const handleAddFilter = (key: FilterKey | "") => {
    if (!key) return;
    setVisibleFilters((current) => (current.includes(key) ? current : [...current, key]));
    setSelectedFilterToAdd("");
  };

  const handleClearFilters = () => {
    setFilters(defaultFilters);
  };

  const toFavoriteAttraction = (attraction: Attraction): FavoriteAttraction => ({
    id: attraction.id,
    name: attraction.name,
    city: attraction.city,
    stateProvince: attraction.stateProvince,
    country: attraction.country,
    latitude: attraction.latitude,
    longitude: attraction.longitude,
    distanceFromPlace: attraction.distanceFromPlace,
    summary: attraction.summary,
    vibe: attraction.vibe,
    rating: attraction.rating,
    totalCountRatings: attraction.totalCountRatings,
    credibilityTier: attraction.credibilityTier,
    reviewsSummary: attraction.reviewsSummary,
    priceLevel: attraction.priceLevel,
    popularityScore: attraction.popularityScore,
    rawData: attraction.rawData,
    lastRefreshed: attraction.lastRefreshed,
    categories: attraction.categories,
    imageUrl: attraction.imageUrl,
    imageUrls: attraction.imageUrls
  });

  const renderFilterField = (key: FilterKey) => {
    const canRemove = true;

    if (key === "city") {
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
          <select value={filters.city} onChange={updateFilter("city")}>
            <option value="">All cities</option>
            {filters.city && !options.cities.includes(filters.city) && (
              <option value={filters.city}>{filters.city}</option>
            )}
            {options.cities.map((city) => (
              <option key={city} value={city}>
                {city}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "stateProvince") {
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
          <select value={filters.stateProvince} onChange={updateFilter("stateProvince")}>
            <option value="">All states/provinces</option>
            {options.stateProvinces.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
      );
    }

    if (key === "countryRegion") {
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
          <select value={filters.countryRegion} onChange={updateFilter("countryRegion")}>
            <option value="">All countries/regions</option>
            {options.countryRegions.map((value) => (
              <option key={value} value={value}>
                {value}
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
      <div className="attractions-header-toolbar">
        <header className="attractions-header">
          <h1>{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </header>

        <div className="attractions-filter-toolbar">
          <div className="attractions-filter-actions">
            <div className="attractions-filter-add-row">
              <select
                value={selectedFilterToAdd}
                onChange={(event) => {
                  const value = event.target.value as FilterKey | "";
                  setSelectedFilterToAdd(value);
                  handleAddFilter(value);
                }}
                disabled={availableFiltersToAdd.length === 0}
              >
                <option value="">
                  {availableFiltersToAdd.length === 0 ? "All filters shown" : "Add a filter"}
                </option>
                {availableFiltersToAdd.map((key) => (
                  <option key={key} value={key}>
                    {filterLabels[key]}
                  </option>
                ))}
              </select>
            </div>

            <button
              type="button"
              className="attractions-filter-clear-button attractions-filter-clear-standalone"
              onClick={handleClearFilters}
            >
              Clear Filters
            </button>
          </div>
        </div>
      </div>

      <section className="attractions-filters" aria-label="Attraction filters">
        <label className="attractions-filter-field attractions-filter-search attractions-filter-search-full">
          <div className="attractions-filter-head">
            <span>{filterLabels.search}</span>
          </div>
          <input
            type="text"
            value={filters.search}
            onChange={updateFilter("search")}
            placeholder="Search by attraction name"
          />
        </label>

        {visibleFilters.map(renderFilterField)}
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
                <article
                  className="attraction-card attraction-card-clickable"
                  key={attraction.id}
                  onClick={() => setSelectedAttraction(attraction)}
                >
                  {attraction.imageUrl ? (
                    (() => {
                      const urls = attraction.imageUrls.length > 0
                        ? attraction.imageUrls
                        : attraction.imageUrl
                          ? [attraction.imageUrl]
                          : [];
                      const index = imageIndexByAttraction[attraction.id] ?? 0;
                      const currentUrl = urls[index];

                      if (!currentUrl) {
                        return (
                          <div className="attraction-card-image-fallback" aria-hidden="true">
                            No image
                          </div>
                        );
                      }

                      return (
                        <img
                          src={currentUrl}
                          alt={attraction.name}
                          className="attraction-card-image"
                          loading="lazy"
                          onError={() => {
                            setImageIndexByAttraction((current) => ({
                              ...current,
                              [attraction.id]: (current[attraction.id] ?? 0) + 1
                            }));
                          }}
                        />
                      );
                    })()
                  ) : (
                    <div className="attraction-card-image-fallback" aria-hidden="true">
                      No image
                    </div>
                  )}

                  <div className="attraction-card-top">
                    <div className="attraction-card-title-row">
                      <h2>{attraction.name}</h2>
                      <div style={{ display: "flex", gap: 8 }}>
                        <button
                          type="button"
                          className={`attraction-favorite-button ${
                            isFavorite(attraction.id) ? "attraction-favorite-button-active" : ""
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavorite(toFavoriteAttraction(attraction));
                          }}
                          aria-label={
                            isFavorite(attraction.id)
                              ? `Remove ${attraction.name} from favorites`
                              : `Add ${attraction.name} to favorites`
                          }
                        >
                          {isFavorite(attraction.id) ? "♥" : "♡"}
                        </button>
                        <button
                          type="button"
                          className="attractions-view-more"
                          onClick={(event) => {
                            event.stopPropagation();
                            addAttraction(toFavoriteAttraction(attraction));
                          }}
                        >
                          Add to itinerary
                        </button>
                      </div>
                    </div>
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
      <AttractionDetailsModal
        attraction={selectedAttraction}
        isFavorited={selectedAttraction ? isFavorite(selectedAttraction.id) : false}
        onToggleFavorite={(attraction) => toggleFavorite(toFavoriteAttraction(attraction))}
        onClose={() => setSelectedAttraction(null)}
      />
    </>
  );
}
