import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import { FavoriteAttraction } from "../lib/favorites-context";
import { useItinerary } from "../lib/itinerary-context";

type Pace = "relaxed" | "balanced" | "packed";
type Slot = "Morning" | "Afternoon" | "Evening";

type PlaceOption = {
  id: number;
  label: string;
  city: string;
  countryRegion: string;
};

/** API attraction shape from /api/attractions */
type ApiAttraction = {
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

function apiAttractionToFavorite(a: ApiAttraction): FavoriteAttraction {
  return {
    id: a.id,
    name: a.name,
    city: a.city,
    stateProvince: a.stateProvince,
    country: a.country,
    latitude: a.latitude,
    longitude: a.longitude,
    distanceFromPlace: a.distanceFromPlace,
    summary: a.summary,
    vibe: a.vibe,
    rating: a.rating,
    totalCountRatings: a.totalCountRatings,
    credibilityTier: a.credibilityTier,
    reviewsSummary: a.reviewsSummary,
    priceLevel: a.priceLevel,
    popularityScore: a.popularityScore,
    rawData: a.rawData,
    lastRefreshed: a.lastRefreshed,
    categories: a.categories,
    imageUrl: a.imageUrl,
    imageUrls: a.imageUrls ?? []
  };
}

type PlannedStop = {
  attraction: FavoriteAttraction;
  slot: Slot;
};

export type DayPlan = {
  dayNumber: number;
  stops: PlannedStop[];
};

export type SavedItinerary = {
  itineraryId: string;
  tripName: string;
  tripPlace?: string;
  startDate: string;
  endDate: string;
  pace: Pace;
  notes: string;
  days: DayPlan[];
  unscheduled: FavoriteAttraction[];
  createdAt?: string;
  updatedAt?: string;
};

type SavedTripBuilderProps = {
  initialItinerary?: SavedItinerary | null;
  itineraryIdFromRoute?: string | null;
};

type BuildResult = {
  days: DayPlan[];
  unscheduled: FavoriteAttraction[];
};

const slotOrder: Slot[] = ["Morning", "Afternoon", "Evening"];

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

function daysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 3;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 3;

  const msDiff = end.getTime() - start.getTime();
  const dayDiff = Math.floor(msDiff / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, dayDiff);
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildItinerary(
  favorites: FavoriteAttraction[],
  tripDays: number,
  pace: Pace,
  randomize: boolean
): BuildResult {
  const stopsPerDay = pace === "relaxed" ? 1 : pace === "packed" ? 3 : 2;
  const capacity = tripDays * stopsPerDay;
  const source = randomize ? shuffle(favorites) : [...favorites];
  const picked = source.slice(0, capacity);
  const unscheduled = source.slice(capacity);

  const days: DayPlan[] = Array.from({ length: tripDays }, (_, index) => ({
    dayNumber: index + 1,
    stops: []
  }));

  picked.forEach((attraction, index) => {
    const dayIndex = Math.floor(index / stopsPerDay);
    const slotIndex = index % stopsPerDay;
    const slot = slotOrder[slotIndex] ?? "Afternoon";

    days[dayIndex].stops.push({ attraction, slot });
  });

  return { days, unscheduled };
}

function sanitizeItineraryId(raw: string | null | undefined) {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

const SUGGESTED_LIMIT = 24;

export default function SavedTripBuilder({ initialItinerary, itineraryIdFromRoute }: SavedTripBuilderProps) {
  const router = useRouter();
  const { attractions, addAttraction, removeAttraction, reorderAttractions, isInItinerary } = useItinerary();

  const today = new Date();
  const defaultStart = today.toISOString().slice(0, 10);
  const defaultEnd = new Date(today.getTime() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10);

  const [placesOptions, setPlacesOptions] = useState<PlaceOption[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceOption | null>(null);
  const [placeInputValue, setPlaceInputValue] = useState("");
  const [placeDropdownOpen, setPlaceDropdownOpen] = useState(false);
  const placeDropdownRef = useRef<HTMLDivElement>(null);
  const [suggestedAttractions, setSuggestedAttractions] = useState<FavoriteAttraction[]>([]);
  const [loadingSuggested, setLoadingSuggested] = useState(false);
  const [tripName, setTripName] = useState(initialItinerary?.tripName ?? "My Weekend Escape");
  const [tripPlace, setTripPlace] = useState(initialItinerary?.tripPlace ?? "");
  const [startDate, setStartDate] = useState(initialItinerary?.startDate ?? defaultStart);
  const [endDate, setEndDate] = useState(initialItinerary?.endDate ?? defaultEnd);
  const [pace, setPace] = useState<Pace>(initialItinerary?.pace ?? "balanced");
  const [notes, setNotes] = useState(initialItinerary?.notes ?? "");
  const [dayPlans, setDayPlans] = useState<DayPlan[]>(initialItinerary?.days ?? []);
  const [unscheduled, setUnscheduled] = useState<FavoriteAttraction[]>(initialItinerary?.unscheduled ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeItineraryId, setActiveItineraryId] = useState<string>(
    sanitizeItineraryId(initialItinerary?.itineraryId ?? itineraryIdFromRoute ?? "")
  );
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isShareCopied, setIsShareCopied] = useState(false);
  const [isLoginNoticeOpen, setIsLoginNoticeOpen] = useState(false);
  const [draggedIndex, setDraggedIndex] = useState<number | null>(null);

  const tripDays = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);
  const totalStops = dayPlans.reduce((sum, day) => sum + day.stops.length, 0);
  const activeTripName = tripName.trim() || "Untitled Trip";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/collab-places");
        const data = (await res.json()) as { options?: PlaceOption[]; error?: string };
        if (!cancelled && data.options) setPlacesOptions(data.options);
      } catch {
        if (!cancelled) setPlacesOptions([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedPlace?.city && !selectedPlace?.countryRegion) {
      setSuggestedAttractions([]);
      return;
    }
    let cancelled = false;
    setLoadingSuggested(true);
    (async () => {
      try {
        const params = new URLSearchParams();
        params.set("limit", String(SUGGESTED_LIMIT));
        params.set("offset", "0");
        // Filter by city only so we match DB (e.g. "United States" vs "USA")
        if (selectedPlace.city) params.set("city", selectedPlace.city);
        const res = await fetch(`/api/attractions?${params.toString()}`);
        const json = (await res.json()) as { data?: ApiAttraction[]; error?: string };
        if (!cancelled && json.data) {
          setSuggestedAttractions(json.data.map(apiAttractionToFavorite));
        } else if (!cancelled) {
          setSuggestedAttractions([]);
        }
      } catch {
        if (!cancelled) setSuggestedAttractions([]);
      } finally {
        if (!cancelled) setLoadingSuggested(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedPlace?.id]);

  useEffect(() => {
    if (!initialItinerary?.tripPlace || placesOptions.length === 0) return;
    const match = placesOptions.find(
      (p) => p.label === initialItinerary.tripPlace || p.label.startsWith(initialItinerary.tripPlace ?? "")
    );
    if (match) {
      setSelectedPlace(match);
      setPlaceInputValue(match.label);
    }
  }, [initialItinerary?.tripPlace, placesOptions]);

  const filteredPlaces = useMemo(() => {
    const q = placeInputValue.trim().toLowerCase();
    if (!q) return placesOptions.slice(0, 50);
    return placesOptions.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.city.toLowerCase().includes(q) ||
        (p.countryRegion && p.countryRegion.toLowerCase().includes(q))
    ).slice(0, 50);
  }, [placesOptions, placeInputValue]);

  useEffect(() => {
    if (!initialItinerary || !initialItinerary.itineraryId) return;
    const id = sanitizeItineraryId(initialItinerary.itineraryId);
    if (!id) return;
    const url = `${window.location.origin}/saved-trips/${encodeURIComponent(id)}`;
    setShareLink(url);
    setActiveItineraryId(id);
  }, [initialItinerary]);

  const handleSelectPlace = useCallback((place: PlaceOption) => {
    setSelectedPlace(place);
    setTripPlace(place.label);
    setPlaceInputValue(place.label);
    setPlaceDropdownOpen(false);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (placeDropdownRef.current && !placeDropdownRef.current.contains(event.target as Node)) {
        setPlaceDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const scheduleAttraction = (attraction: FavoriteAttraction) => {
    const stopsPerDay = pace === "relaxed" ? 1 : pace === "packed" ? 3 : 2;
    const currentTotalStops = dayPlans.reduce((sum, day) => sum + day.stops.length, 0);
    const dayIndex = Math.floor(currentTotalStops / stopsPerDay);
    if (dayIndex >= tripDays) {
      return;
    }
    const slotIndex = currentTotalStops % stopsPerDay;
    const slot = slotOrder[slotIndex] ?? "Afternoon";

    setDayPlans((current) => {
      const next = current.map((day) => ({ ...day, stops: [...day.stops] }));
      while (next.length < tripDays) {
        next.push({ dayNumber: next.length + 1, stops: [] });
      }
      next[dayIndex].stops.push({ attraction, slot });
      return next;
    });
  };

  const handleBuild = (randomize: boolean) => {
    if (attractions.length === 0) {
      setDayPlans([]);
      setUnscheduled([]);
      return;
    }

    const built = buildItinerary(attractions, tripDays, pace, randomize);
    setDayPlans(built.days);
    setUnscheduled(built.unscheduled);
  };

  const clearPlan = () => {
    setDayPlans([]);
    setUnscheduled([]);
    setNotes("");
  };

  async function handleSave(event?: FormEvent) {
    if (event) event.preventDefault();

    setIsSaving(true);
    setSaveError(null);
    setIsShareCopied(false);

    const payload = {
      itineraryId: activeItineraryId || undefined,
      tripName: activeTripName,
      tripPlace: tripPlace.trim(),
      startDate,
      endDate,
      pace,
      notes,
      days: dayPlans,
      unscheduled
    };

    try {
      const response = await fetch("/api/itinerary", {
        method: activeItineraryId ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json()) as { itineraryId?: string; path?: string; error?: string };

      if (!response.ok || !data.itineraryId || !data.path) {
        throw new Error(data.error || "Failed to save itinerary.");
      }

      const sanitizedId = sanitizeItineraryId(data.itineraryId);
      const fullShareLink = `${window.location.origin}${data.path}`;

      setActiveItineraryId(sanitizedId);
      setShareLink(fullShareLink);

      const currentPath = router.asPath;
      if (!currentPath.includes(`/saved-trips/${sanitizedId}`)) {
        router.push(`/saved-trips/${encodeURIComponent(sanitizedId)}`, undefined, { shallow: false });
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unknown error saving itinerary.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCopyShareLink() {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setIsShareCopied(true);
    } catch {
      setIsShareCopied(false);
    }
  }

  return (
    <main className="destinations-page">
      <header className="destinations-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <button type="button" className="destinations-login" onClick={() => setIsLoginNoticeOpen(true)}>
          Login
        </button>
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">💾</span>
            <span>Itinerary</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/favorites")}>
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/collaborate")}>
            <span aria-hidden="true">👥</span>
            <span>Collaborate</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/ai-chatbot")}>
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/about")}>
            <span aria-hidden="true">ℹ️</span>
            <span>About</span>
          </button>
        </nav>

        <div className="destinations-content">
          <section className="saved-trips-header">
            <h1>Itinerary</h1>
            <p>Turn your favorites into a ready-to-go itinerary in one click and save it with a shareable link.</p>
          </section>

          <form className="saved-trips-builder" onSubmit={handleSave}>
            <div className="saved-trips-field">
              <label htmlFor="trip-name">Trip Name</label>
              <input
                id="trip-name"
                type="text"
                value={tripName}
                onChange={(event) => setTripName(event.target.value)}
                placeholder="Name your trip"
              />
            </div>
            <div className="saved-trips-field saved-trips-field-place" ref={placeDropdownRef}>
              <label htmlFor="trip-place">Trip location</label>
              <input
                id="trip-place"
                type="text"
                value={placeInputValue}
                onChange={(e) => {
                  setPlaceInputValue(e.target.value);
                  setPlaceDropdownOpen(true);
                  if (!e.target.value.trim()) {
                    setSelectedPlace(null);
                    setTripPlace("");
                  }
                }}
                onFocus={() => setPlaceDropdownOpen(true)}
                onBlur={() => {
                  // Delay so option click registers
                  setTimeout(() => setPlaceDropdownOpen(false), 180);
                }}
                placeholder="Type to search destinations…"
                autoComplete="off"
                aria-label="Trip location — type to search and pick a destination"
                aria-expanded={placeDropdownOpen}
                aria-haspopup="listbox"
                aria-controls="trip-place-listbox"
                role="combobox"
              />
              {placeDropdownOpen && (
                <ul
                  id="trip-place-listbox"
                  className="saved-trips-place-listbox"
                  role="listbox"
                  aria-label="Available destinations"
                >
                  {filteredPlaces.length === 0 ? (
                    <li className="saved-trips-place-option saved-trips-place-option-empty" role="option">
                      No matching places
                    </li>
                  ) : (
                    filteredPlaces.map((p) => (
                      <li
                        key={p.id}
                        role="option"
                        className="saved-trips-place-option"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          handleSelectPlace(p);
                        }}
                        aria-selected={selectedPlace?.id === p.id}
                      >
                        {p.label}
                      </li>
                    ))
                  )}
                </ul>
              )}
            </div>
            <div className="saved-trips-field">
              <label htmlFor="trip-start">Start</label>
              <input
                id="trip-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="saved-trips-field">
              <label htmlFor="trip-end">End</label>
              <input
                id="trip-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div className="saved-trips-field">
              <label htmlFor="trip-pace">Pace</label>
              <select
                id="trip-pace"
                value={pace}
                onChange={(event) => setPace(event.target.value as Pace)}
              >
                <option value="relaxed">Relaxed (1 stop/day)</option>
                <option value="balanced">Balanced (2 stops/day)</option>
                <option value="packed">Packed (3 stops/day)</option>
              </select>
            </div>
            <div className="saved-trips-actions">
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                onClick={() => handleBuild(false)}
              >
                Build Itinerary
              </button>
              <button type="button" className="saved-trips-button" onClick={() => handleBuild(true)}>
                Surprise Me
              </button>
              <button type="button" className="saved-trips-button saved-trips-button-muted" onClick={clearPlan}>
                Clear Plan
              </button>
            </div>
          </form>

          <section className="saved-trips-stats">
            <article>
              <h3>Trip</h3>
              <p>{activeTripName}</p>
            </article>
            <article>
              <h3>Days</h3>
              <p>{tripDays}</p>
            </article>
            <article>
              <h3>Ideas Selected</h3>
              <p>{attractions.length}</p>
            </article>
            <article>
              <h3>Stops Scheduled</h3>
              <p>{totalStops}</p>
            </article>
          </section>

          {selectedPlace && (
            <section className="saved-suggested-section" aria-labelledby="suggested-heading">
              <h2 id="suggested-heading">Suggested in {selectedPlace.label}</h2>
              <p className="saved-suggested-intro">Click + to add a place to your itinerary.</p>
              {loadingSuggested ? (
                <p className="saved-suggested-loading">Loading suggestions…</p>
              ) : (
                <div className="saved-suggested-grid">
                  {suggestedAttractions.map((attraction) => {
                    const added = isInItinerary(attraction.id);
                    return (
                      <article className="saved-suggested-card" key={attraction.id}>
                        {attraction.imageUrl ? (
                          <img
                            src={attraction.imageUrl}
                            alt=""
                            className="saved-suggested-card-img"
                          />
                        ) : (
                          <div className="saved-suggested-card-img saved-suggested-card-placeholder" aria-hidden />
                        )}
                        <div className="saved-suggested-card-body">
                          <h3>{attraction.name}</h3>
                          <p className="saved-suggested-card-meta">
                            {formatLocation(attraction.city, attraction.stateProvince, attraction.country)}
                          </p>
                          {attraction.summary && (
                            <p className="saved-suggested-card-summary">
                              {attraction.summary.slice(0, 120)}
                              {attraction.summary.length > 120 ? "…" : ""}
                            </p>
                          )}
                          <button
                            type="button"
                            className={`saved-suggested-add ${added ? "saved-suggested-added" : ""}`}
                            aria-label={added ? `${attraction.name} already in itinerary` : `Add ${attraction.name} to itinerary`}
                            onClick={() => {
                              if (!added) addAttraction(attraction);
                            }}
                            disabled={added}
                          >
                            {added ? "✓ Added" : "+ Add"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          <section className="saved-itinerary-cards-section" aria-labelledby="your-itinerary-heading">
            <h2 id="your-itinerary-heading">Your itinerary</h2>
            <p className="saved-itinerary-cards-intro">Drag to reorder. Use Build Itinerary to assign days.</p>
            {attractions.length === 0 ? (
              <p className="saved-itinerary-cards-empty">
                No places yet. Pick a location above to see suggestions, or add from Destinations.
              </p>
            ) : (
              <div
                className="saved-itinerary-cards"
                role="list"
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                }}
              >
                {attractions.map((attraction, index) => (
                  <div
                    key={attraction.id}
                    className={`saved-itinerary-card ${draggedIndex === index ? "saved-itinerary-card-dragging" : ""}`}
                    role="listitem"
                    draggable
                    data-index={index}
                    onDragStart={(e) => {
                      setDraggedIndex(index);
                      e.dataTransfer.effectAllowed = "move";
                      e.dataTransfer.setData("text/plain", String(index));
                      e.dataTransfer.setData("application/json", JSON.stringify({ index }));
                    }}
                    onDragEnd={() => setDraggedIndex(null)}
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      const from = Number(e.dataTransfer.getData("text/plain"));
                      const to = index;
                      if (Number.isFinite(from) && Number.isFinite(to) && from !== to) {
                        reorderAttractions(from, to);
                      }
                      setDraggedIndex(null);
                    }}
                  >
                    <span className="saved-itinerary-card-handle" aria-hidden title="Drag to reorder">
                      ⋮⋮
                    </span>
                    {attraction.imageUrl ? (
                      <img src={attraction.imageUrl} alt="" className="saved-itinerary-card-img" />
                    ) : (
                      <div className="saved-itinerary-card-img saved-itinerary-card-placeholder" aria-hidden />
                    )}
                    <div className="saved-itinerary-card-body">
                      <h3>{attraction.name}</h3>
                      <p className="saved-itinerary-card-meta">
                        {formatLocation(attraction.city, attraction.stateProvince, attraction.country)}
                      </p>
                    </div>
                    <button
                      type="button"
                      className="saved-itinerary-card-remove"
                      aria-label={`Remove ${attraction.name} from itinerary`}
                      onClick={() => {
                        removeAttraction(attraction.id);
                        setDayPlans((current) =>
                          current.map((day) => ({
                            ...day,
                            stops: day.stops.filter((s) => s.attraction.id !== attraction.id)
                          }))
                        );
                        setUnscheduled((current) => current.filter((item) => item.id !== attraction.id));
                      }}
                    >
                      🗑
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {attractions.length === 0 ? (
            <section className="saved-trips-empty">
              <h2>No places in your itinerary yet</h2>
              <p>Pick a location above to see suggested places, or go to Destinations to add places. They’ll appear here and you can drag to reorder.</p>
              <div className="saved-trips-empty-actions">
                <button
                  type="button"
                  className="saved-trips-button saved-trips-button-primary"
                  onClick={() => router.push("/home")}
                >
                  Browse Destinations
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="saved-trips-notes">
                <label htmlFor="trip-notes">Trip Notes</label>
                <textarea
                  id="trip-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add reminders: reservations, neighborhood plans, must-eat spots..."
                  rows={3}
                />
              </section>

              <section className="saved-trips-timeline">
                {dayPlans.length === 0 ? (
                  <p className="saved-trips-state">
                    Build an itinerary to see your day-by-day plan.
                  </p>
                ) : (
                  dayPlans.map((day) => (
                    <article className="saved-day-card" key={day.dayNumber}>
                      <header>
                        <h2>Day {day.dayNumber}</h2>
                      </header>

                      {day.stops.length === 0 ? (
                        <p className="saved-day-empty">No stops for this day.</p>
                      ) : (
                        <div className="saved-day-stops">
                          {day.stops.map((stop) => (
                            <div
                              className="saved-stop"
                              key={`${day.dayNumber}-${stop.attraction.id}-${stop.slot}`}
                            >
                              <span className="saved-stop-slot">{stop.slot}</span>
                              <div className="saved-stop-content">
                                <div className="saved-stop-header">
                                  <h3>{stop.attraction.name}</h3>
                                  <button
                                    type="button"
                                    className="saved-stop-remove"
                                    aria-label={`Remove ${stop.attraction.name} from itinerary`}
                                    onClick={() => {
                                      setDayPlans((current) =>
                                        current.map((existingDay) =>
                                          existingDay.dayNumber !== day.dayNumber
                                            ? existingDay
                                            : {
                                                ...existingDay,
                                                stops: existingDay.stops.filter(
                                                  (s) =>
                                                    !(
                                                      s.attraction.id === stop.attraction.id &&
                                                      s.slot === stop.slot
                                                    )
                                                )
                                              }
                                        )
                                      );
                                      setUnscheduled((current) =>
                                        current.filter((item) => item.id !== stop.attraction.id)
                                      );
                                      removeAttraction(stop.attraction.id);
                                    }}
                                  >
                                    🗑
                                  </button>
                                </div>
                                <p>
                                  {formatLocation(
                                    stop.attraction.city,
                                    stop.attraction.stateProvince,
                                    stop.attraction.country
                                  )}
                                </p>
                                {stop.attraction.categories.length > 0 && (
                                  <p className="saved-stop-tags">
                                    {stop.attraction.categories.slice(0, 3).join(" • ")}
                                  </p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </section>

              {unscheduled.length > 0 && (
                <section className="saved-trips-unscheduled">
                  <h2>Still on your list</h2>
                  <p>These did not fit your current date range and pace.</p>
                  <div className="saved-unscheduled-grid">
                    {unscheduled.map((attraction) => (
                      <article className="saved-unscheduled-item" key={attraction.id}>
                        <div className="saved-stop-header">
                          <h3>{attraction.name}</h3>
                          <div className="saved-stop-actions">
                            <button
                              type="button"
                              className="saved-stop-add"
                              aria-label={`Add ${attraction.name} to itinerary schedule`}
                              onClick={() => {
                                scheduleAttraction(attraction);
                                setUnscheduled((current) =>
                                  current.filter((item) => item.id !== attraction.id)
                                );
                              }}
                            >
                              ➕
                            </button>
                            <button
                              type="button"
                              className="saved-stop-remove"
                              aria-label={`Remove ${attraction.name} from itinerary`}
                              onClick={() => {
                                setUnscheduled((current) =>
                                  current.filter((item) => item.id !== attraction.id)
                                );
                                setDayPlans((current) =>
                                  current.map((existingDay) => ({
                                    ...existingDay,
                                    stops: existingDay.stops.filter(
                                      (stop) => stop.attraction.id !== attraction.id
                                    )
                                  }))
                                );
                                removeAttraction(attraction.id);
                              }}
                            >
                              🗑
                            </button>
                          </div>
                        </div>
                        <p>
                          {formatLocation(
                            attraction.city,
                            attraction.stateProvince,
                            attraction.country
                          )}
                        </p>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}

          <section className="saved-trips-share">
            <div className="saved-trips-actions" style={{ marginTop: 12 }}>
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : activeItineraryId ? "Save Changes" : "Save & Get Shareable Link"}
              </button>
              {shareLink && (
                <button
                  type="button"
                  className="saved-trips-button"
                  onClick={handleCopyShareLink}
                >
                  {isShareCopied ? "Link Copied!" : "Copy Share Link"}
                </button>
              )}
            </div>
            {shareLink && (
              <p className="attractions-state" style={{ marginTop: 8 }}>
                Anyone with this link can view and edit this itinerary: {shareLink}
              </p>
            )}
            {saveError && (
              <p className="attractions-state attractions-state-error" style={{ marginTop: 8 }}>
                {saveError}
              </p>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}

