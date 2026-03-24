import { FormEvent, forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "./AppShell";
import AttractionDetailsModal from "./AttractionDetailsModal";
import { useAuth } from "../lib/auth-context";
import { useCart } from "../lib/cart-context";
import { FavoriteAttraction, useFavorites } from "../lib/favorites-context";
import { useItinerary } from "../lib/itinerary-context";
import { useUndo } from "../lib/undo-context";
import {
  clearWorkingItinerary,
  loadWorkingItinerary,
  saveWorkingItinerary,
  setCurrentItineraryId
} from "../lib/working-itinerary-storage";

type Pace = "relaxed" | "balanced" | "packed";

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
  /** Local trip start time as HH:MM (24h) */
  startTime: string;
  /** Duration in minutes */
  durationMinutes: number;
};

export type DayPlan = {
  dayNumber: number;
  stops: PlannedStop[];
};

export type ExtraPlaceItem = {
  placeId?: number;
  label: string;
  city: string;
  countryRegion: string;
};

export type SavedItinerary = {
  itineraryId: string;
  tripName: string;
  tripPlace?: string;
  extraPlaces?: ExtraPlaceItem[];
  startDate: string;
  endDate: string;
  pace: Pace;
  notes: string;
  days: DayPlan[];
  unscheduled: FavoriteAttraction[];
  collabVoteStats?: Record<number, { yesVotes: number; noVotes: number }>;
  createdAt?: string;
  updatedAt?: string;
  requiresShareCode?: boolean;
  shareCode?: string;
};

type SavedTripBuilderProps = {
  initialItinerary?: SavedItinerary | null;
  itineraryIdFromRoute?: string | null;
  /** When true, render only the inner itinerary UI without the global header/sidebar chrome. */
  embedded?: boolean;
  /** Optional starting location when no initialItinerary is provided (e.g. from solo-planner place query). */
  initialTripPlace?: string;
};

type DragSource =
  | { type: "day"; dayIndex: number; slotIndex: number }
  | { type: "unscheduled"; index: number }
  | { type: "suggested"; attraction: FavoriteAttraction };

type ExtraSuggestionSection = {
  id: string;
  label: string;
  attractions: FavoriteAttraction[];
  loading: boolean;
  collapsed: boolean;
  searchQuery?: string;
};

type SuggestSort = "name-asc" | "category-asc" | "rating-desc" | "popularity-desc";

type CustomEventDialogState =
  | {
      mode: "create";
      dayIndex?: number;
      requestedMinute?: number;
    }
  | {
      mode: "edit";
      eventId: number;
    };

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

function formatCategoryLabel(categories: string[] | undefined): string {
  if (!categories?.length) return "";
  return categories.slice(0, 2).join(" • ").trim();
}

function filterAndSortAttractions(
  list: FavoriteAttraction[],
  searchQuery: string,
  sortBy: SuggestSort,
  maxPriceLevel: string,
  categoryFilter: string
) {
  const q = searchQuery.trim().toLowerCase();
  const maxPrice = Number(maxPriceLevel);
  const hasPriceFilter = Number.isFinite(maxPrice) && maxPrice > 0;

  const filtered = list.filter((attraction) => {
    if (q) {
      const haystack = `${attraction.name} ${attraction.city ?? ""} ${attraction.stateProvince ?? ""} ${
        attraction.country ?? ""
      } ${attraction.summary ?? ""}`.toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    if (hasPriceFilter) {
      const level = (attraction.priceLevel ?? "").trim();
      if (!level) return false;
      const priceCount = (level.match(/\$/g) ?? []).length;
      if (priceCount === 0 || priceCount > maxPrice) return false;
    }
    if (categoryFilter !== "all") {
      const categories = attraction.categories ?? [];
      const hasCategory = categories.some(
        (category) => category.trim().toLowerCase() === categoryFilter
      );
      if (!hasCategory) return false;
    }
    return true;
  });

  return filtered.sort((left, right) => {
    if (sortBy === "category-asc") {
      const leftCategory = (left.categories?.[0] ?? "zzz").toLowerCase();
      const rightCategory = (right.categories?.[0] ?? "zzz").toLowerCase();
      if (leftCategory !== rightCategory) return leftCategory.localeCompare(rightCategory);
      return left.name.localeCompare(right.name);
    }
    if (sortBy === "rating-desc") return (right.rating ?? -1) - (left.rating ?? -1);
    if (sortBy === "popularity-desc") return (right.popularityScore ?? -1) - (left.popularityScore ?? -1);
    return left.name.localeCompare(right.name);
  });
}

function isCustomEvent(attraction: FavoriteAttraction | null | undefined) {
  if (!attraction) return false;
  return attraction.rawData === "custom-event";
}

function getAttractionMeta(attraction: FavoriteAttraction) {
  if (isCustomEvent(attraction)) return "Custom event";
  const location = formatLocation(attraction.city, attraction.stateProvince, attraction.country);
  const categoryLabel = formatCategoryLabel(attraction.categories);
  return categoryLabel ? `${location} · ${categoryLabel}` : location;
}

function createCustomEvent(name: string): FavoriteAttraction {
  const trimmed = name.trim();
  const idSeed = Date.now() + Math.floor(Math.random() * 100000);
  return {
    id: -idSeed,
    name: trimmed,
    city: "",
    stateProvince: "",
    country: "",
    latitude: null,
    longitude: null,
    distanceFromPlace: null,
    summary: "Custom event",
    vibe: "",
    rating: null,
    totalCountRatings: null,
    credibilityTier: null,
    reviewsSummary: "",
    priceLevel: "",
    popularityScore: null,
    rawData: "custom-event",
    lastRefreshed: new Date().toISOString(),
    categories: ["Custom event"],
    imageUrl: null,
    imageUrls: []
  };
}

function intervalsOverlap(startA: number, endA: number, startB: number, endB: number) {
  return startA < endB && startB < endA;
}

/** Parse "HH:MM" to minutes since midnight. Returns 0 for invalid. */
function timeToMinutes(hhmm: string): number {
  const m = (hhmm || "09:00").match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return 9 * 60;
  return Math.max(0, Math.min(24 * 60 - 1, Number(m[1]) * 60 + Number(m[2])));
}

/** Minutes since midnight to "HH:MM". */
function minutesToTime(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.floor(minutes)));
  const h = Math.floor(m / 60);
  const min = m % 60;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

function formatLocalDateIso(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function parseLocalDateIso(value: string) {
  const m = (value ?? "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (!Number.isFinite(y) || !Number.isFinite(mo) || !Number.isFinite(d)) return null;
  // Construct a local-time Date at midnight to avoid UTC day-shift bugs.
  return new Date(y, mo - 1, d);
}

function formatTimeLabel(startTime: string, durationMinutes: number): string {
  const safeTime = startTime && /^\d{2}:\d{2}$/.test(startTime) ? startTime : "09:00";
  const total = Math.max(0, Math.floor(durationMinutes || 0));
  const hours = Math.floor(total / 60);
  const remainingMinutes = total % 60;
  if (!durationMinutes || durationMinutes <= 0) {
    return safeTime;
  }
  if (hours && remainingMinutes) {
    return `${safeTime} • ${hours}h ${remainingMinutes}m`;
  }
  if (hours) {
    return `${safeTime} • ${hours}h`;
  }
  return `${safeTime} • ${remainingMinutes}m`;
}

function formatCalendarTimeRange(startTime: string, durationMinutes: number): string {
  const startMinutes = timeToMinutes(startTime || "09:00");
  const endMinutes = Math.min(24 * 60, startMinutes + Math.max(0, durationMinutes || 0));
  return `${formatMinuteLabel(startMinutes)} to ${formatMinuteLabel(endMinutes)}`;
}

function formatMinuteLabel(totalMinutes: number) {
  const clamped = Math.max(0, Math.min(24 * 60, Math.floor(totalMinutes)));
  if (clamped === 24 * 60) return "12 AM";
  const hours24 = Math.floor(clamped / 60);
  const minutes = clamped % 60;
  const suffix = hours24 >= 12 ? "PM" : "AM";
  const hours12 = hours24 % 12 || 12;
  if (minutes === 0) return `${hours12} ${suffix}`;
  return `${hours12}:${String(minutes).padStart(2, "0")} ${suffix}`;
}

function daysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 3;

  const start = parseLocalDateIso(startDate) ?? new Date(startDate);
  const end = parseLocalDateIso(endDate) ?? new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 3;

  const msDiff = end.getTime() - start.getTime();
  const dayDiff = Math.floor(msDiff / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, dayDiff);
}

function formatDateForIcs(date: Date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function formatTimeForIcs(hours: number, minutes: number) {
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${hh}${mm}00`;
}

function sanitizeItineraryId(raw: string | null | undefined) {
  if (!raw) return "";
  return raw
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const SUGGESTED_LIMIT = 24;
const SAMPLE_TRIAL_START_MINUTE = 0;
const SAMPLE_TRIAL_END_MINUTE = 24 * 60;
const SAMPLE_TRIAL_STEP_MINUTES = 60;
const SAMPLE_TRIAL_DEFAULT_DURATION = 90;
const SAMPLE_TRIAL_PX_PER_STEP = 44;

export type SavedTripBuilderHandle = {
  save: () => Promise<void>;
  isSaving: boolean;
  hasBeenSaved: boolean;
};

const SavedTripBuilderComponent = forwardRef<SavedTripBuilderHandle, SavedTripBuilderProps>(
  function SavedTripBuilder(
    { initialItinerary, itineraryIdFromRoute, embedded, initialTripPlace },
    ref
  ) {
  const router = useRouter();
  const { user } = useAuth();
  const { toggleFavorite, isFavorite, addFavorite, removeFavorite } = useFavorites();
  const { addUndo } = useUndo();
  const { attractions, addAttraction, removeAttraction, clearAttractions, isInItinerary } = useItinerary();
  const { moveCartToItinerary } = useCart();

  const [selectedAttraction, setSelectedAttraction] = useState<FavoriteAttraction | null>(null);

  const today = new Date();
  const defaultStart = formatLocalDateIso(today);
  const defaultEnd = formatLocalDateIso(new Date(today.getTime() + 1000 * 60 * 60 * 24 * 2));

  const [placesOptions, setPlacesOptions] = useState<PlaceOption[]>([]);
  const [selectedPlace, setSelectedPlace] = useState<PlaceOption | null>(null);
  const [placeInputValue, setPlaceInputValue] = useState("");
  const [placeDropdownOpen, setPlaceDropdownOpen] = useState(false);
  const placeDropdownRef = useRef<HTMLDivElement>(null);
  const [suggestedAttractions, setSuggestedAttractions] = useState<FavoriteAttraction[]>([]);
  const [loadingSuggested, setLoadingSuggested] = useState(false);
  const [tripName, setTripName] = useState(initialItinerary?.tripName ?? "");
  const [tripPlace, setTripPlace] = useState(initialItinerary?.tripPlace ?? initialTripPlace ?? "");
  const [startDate, setStartDate] = useState(initialItinerary?.startDate ?? defaultStart);
  const [endDate, setEndDate] = useState(initialItinerary?.endDate ?? defaultEnd);
  const [pace, setPace] = useState<Pace>(initialItinerary?.pace ?? "balanced");
  const [notes, setNotes] = useState(initialItinerary?.notes ?? "");
  const [dayPlans, setDayPlans] = useState<DayPlan[]>(initialItinerary?.days ?? []);
  const dayPlansRef = useRef(dayPlans);
  dayPlansRef.current = dayPlans;
  const [unscheduled, setUnscheduled] = useState<FavoriteAttraction[]>(initialItinerary?.unscheduled ?? []);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeItineraryId, setActiveItineraryId] = useState<string>(
    sanitizeItineraryId(initialItinerary?.itineraryId ?? itineraryIdFromRoute ?? "")
  );
  const hasBeenSavedRef = useRef(false);
  const [shareLink, setShareLink] = useState<string | null>(null);
  const [isShareCopied, setIsShareCopied] = useState(false);
  const [isShareCodeCopied, setIsShareCodeCopied] = useState(false);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [shareCode, setShareCode] = useState<string | null>(initialItinerary?.shareCode ?? null);
  const [collabVoteStats, setCollabVoteStats] = useState<
    Record<number, { yesVotes: number; noVotes: number }> | undefined
  >(initialItinerary?.collabVoteStats);
  const [unscheduledSort, setUnscheduledSort] = useState<"votes" | "name">("votes");
  const [extraSuggestionSections, setExtraSuggestionSections] = useState<ExtraSuggestionSection[]>([]);
  const [newSuggestionLocation, setNewSuggestionLocation] = useState("");
  const isCollabItinerary =
    router.query.fromCollab || (initialItinerary?.tripName?.startsWith?.("Collab: ") ?? false);
  const [primarySuggestionsCollapsed, setPrimarySuggestionsCollapsed] = useState(false);
  const [addLocationExpanded, setAddLocationExpanded] = useState(false);
  const [extraPlacesOptions, setExtraPlacesOptions] = useState<PlaceOption[]>([]);
  const [extraPlaceDropdownOpen, setExtraPlaceDropdownOpen] = useState(false);
  const extraPlaceDropdownRef = useRef<HTMLDivElement>(null);
  const [calendarResizeState, setCalendarResizeState] = useState<{
    dayIndex: number;
    slotIndex: number;
    startY: number;
    initialStartMinute: number;
    initialDuration: number;
    edge: "top" | "bottom";
  } | null>(null);
  const seededExtraFromItineraryRef = useRef(false);
  const calendarTimeSlots = useMemo(() => {
    const slots: number[] = [];
    for (
      let minute = SAMPLE_TRIAL_START_MINUTE;
      minute <= SAMPLE_TRIAL_END_MINUTE;
      minute += SAMPLE_TRIAL_STEP_MINUTES
    ) {
      slots.push(minute);
    }
    return slots;
  }, []);
  const calendarGridHeight = (calendarTimeSlots.length - 1) * SAMPLE_TRIAL_PX_PER_STEP;

  const tripDays = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);

  /** Padded day plans so we always have tripDays entries for drop zones */
  const paddedDayPlans = useMemo(() => {
    const next = [...dayPlans];
    while (next.length < tripDays) {
      next.push({ dayNumber: next.length + 1, stops: [] });
    }
    return next.slice(0, tripDays);
  }, [dayPlans, tripDays]);

  /**
   * When the trip date range shrinks (fewer tripDays), move any stops on
   * days that are no longer visible into Unassigned instead of keeping them
   * hidden on trimmed days.
   */
  useEffect(() => {
    setDayPlans((current) => {
      if (!current.length) return current;

      const kept: DayPlan[] = [];
      const removedAttractions: FavoriteAttraction[] = [];

      for (const day of current) {
        if (day.dayNumber <= tripDays) {
          kept.push(day);
        } else if (day.stops?.length) {
          for (const stop of day.stops) {
            if (stop?.attraction) removedAttractions.push(stop.attraction);
          }
        }
      }

      if (!removedAttractions.length) return current;

      setUnscheduled((prev) => {
        const existingIds = new Set(prev.map((a) => a.id));
        const additions = removedAttractions.filter(
          (a) => a && typeof a.id === "number" && !existingIds.has(a.id)
        );
        if (!additions.length) return prev;
        return [...prev, ...additions];
      });

      return kept;
    });
  }, [tripDays]);

  const activeTripName = tripName.trim() || "Untitled Trip";

  useEffect(() => {
    if (isCollabItinerary) setPrimarySuggestionsCollapsed(true);
  }, [isCollabItinerary]);

  useEffect(() => {
    const q = placeInputValue.trim();
    if (!q) {
      setPlacesOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set("search", q);
        const res = await fetch(`/api/collab-places?${params.toString()}`);
        let data: { options?: PlaceOption[]; error?: string } = {};
        try {
          const text = await res.text();
          if (text && text.trim().startsWith("{")) data = JSON.parse(text);
        } catch {
          /* response was not valid JSON (e.g. HTML error page) */
        }
        if (!cancelled && data.options) setPlacesOptions(data.options);
        else if (!cancelled) setPlacesOptions([]);
      } catch {
        if (!cancelled) setPlacesOptions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [placeInputValue]);


  /** Debounced collab-places search for "Add another location" input */
  useEffect(() => {
    const q = newSuggestionLocation.trim();
    if (!q) {
      setExtraPlacesOptions([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        params.set("search", q);
        const res = await fetch(`/api/collab-places?${params.toString()}`);
        let data: { options?: PlaceOption[]; error?: string } = {};
        try {
          const text = await res.text();
          if (text && text.trim().startsWith("{")) data = JSON.parse(text);
        } catch {
          /* response was not valid JSON */
        }
        if (!cancelled && data.options) setExtraPlacesOptions(data.options);
        else if (!cancelled) setExtraPlacesOptions([]);
      } catch {
        if (!cancelled) setExtraPlacesOptions([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [newSuggestionLocation]);

  /**
   * When viewing an existing itinerary, seed extra suggestion sections from
   * saved extraPlaces (if any), or infer from attraction cities.
   *
   * Important: we only do this **once per itinerary**, so if the user later
   * deletes all extra locations, they stay deleted and don't get re-created.
   */
  useEffect(() => {
    if (!initialItinerary) return;
    if (seededExtraFromItineraryRef.current) return;
    if (extraSuggestionSections.length > 0) return;

    const savedExtra = initialItinerary.extraPlaces ?? [];
    if (savedExtra.length > 0) {
      const sections: ExtraSuggestionSection[] = savedExtra
        .filter((ep) => ep?.label?.trim())
        .map((ep) => ({
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
          label: ep.label.trim(),
          attractions: [],
          loading: true,
          collapsed: false
        }));
      setExtraSuggestionSections(sections);
      seededExtraFromItineraryRef.current = true;
      sections.forEach((section, idx) => {
        const ep = savedExtra[idx]!;
        const place: PlaceOption = {
          id: ep.placeId ?? -1,
          label: ep.label,
          city: ep.city ?? "",
          countryRegion: ep.countryRegion ?? ""
        };
        void handleAddExtraLocationForSection(section.id, place);
      });
      return;
    }

    const primaryLabel = (initialItinerary.tripPlace ?? "").trim();
    const primaryCityKey = primaryLabel.split(",")[0]?.trim().toLowerCase() ?? "";

    const seen = new Set<string>();
    const candidates: { label: string; city: string; countryRegion: string }[] = [];

    const addFromAttraction = (a: FavoriteAttraction) => {
      const city = (a.city ?? "").trim();
      const country = (a.country ?? "").trim();
      if (!city && !country) return;

      const label = city && country ? `${city}, ${country}` : city || country;
      if (!label) return;

      const cityKey = city.toLowerCase();
      if (primaryCityKey && cityKey && cityKey === primaryCityKey) return;

      const key = label.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      candidates.push({ label, city, countryRegion: country });
    };

    for (const day of initialItinerary.days ?? []) {
      for (const stop of day.stops) addFromAttraction(stop.attraction);
    }
    for (const a of initialItinerary.unscheduled ?? []) addFromAttraction(a);

    if (candidates.length === 0) return;

    for (const c of candidates) {
      const place: PlaceOption = {
        id: -1,
        label: c.label,
        city: c.city,
        countryRegion: c.countryRegion
      };
      // Fire-and-forget; this will create the section and load suggestions
      // for the inferred location without blocking initial render.
      void handleAddExtraLocation(place);
    }
    seededExtraFromItineraryRef.current = true;
  }, [
    initialItinerary?.itineraryId,
    initialItinerary?.tripPlace,
    initialItinerary?.days,
    initialItinerary?.unscheduled,
    initialItinerary?.extraPlaces,
    extraSuggestionSections.length
  ]);

  const [suggestSearchQuery, setSuggestSearchQuery] = useState("");
  const [suggestSearchResults, setSuggestSearchResults] = useState<FavoriteAttraction[]>([]);
  const [isSearchingSuggestions, setIsSearchingSuggestions] = useState(false);
  const [suggestSortBy, setSuggestSortBy] = useState<SuggestSort>("name-asc");
  const [suggestMaxPriceLevel, setSuggestMaxPriceLevel] = useState("0");
  const [suggestCategoryFilter, setSuggestCategoryFilter] = useState("all");
  const [shareMenuOpen, setShareMenuOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [customDurationByAttractionId, setCustomDurationByAttractionId] = useState<Record<number, number>>({});
  const [customEventDialog, setCustomEventDialog] = useState<CustomEventDialogState | null>(null);
  const [customEventDialogName, setCustomEventDialogName] = useState("");
  const [customEventDialogDuration, setCustomEventDialogDuration] = useState(90);

  function updateSectionSearch(sectionId: string, query: string) {
    setExtraSuggestionSections((sections) =>
      sections.map((s) => (s.id === sectionId ? { ...s, searchQuery: query } : s))
    );
  }

  const displayedUnscheduled = useMemo(() => {
    if (!collabVoteStats || Object.keys(collabVoteStats).length === 0) return unscheduled;
    if (unscheduledSort === "name") {
      return [...unscheduled].sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...unscheduled].sort((a, b) => {
      const aStats = collabVoteStats[a.id];
      const bStats = collabVoteStats[b.id];
      const aNet = aStats ? aStats.yesVotes - aStats.noVotes : -Infinity;
      const bNet = bStats ? bStats.yesVotes - bStats.noVotes : -Infinity;
      return bNet - aNet;
    });
  }, [unscheduled, collabVoteStats, unscheduledSort]);

  /** Effective trip location: from dropdown selection, input, or saved/prop value */
  const effectiveLocation = useMemo(
    () =>
      (selectedPlace?.label ?? placeInputValue.trim() ?? tripPlace.trim() ?? initialTripPlace ?? "").trim(),
    [selectedPlace?.label, placeInputValue, tripPlace, initialTripPlace]
  );

  /** Debounced search within primary suggestions (uses /api/attractions similar to Destinations) */
  useEffect(() => {
    const q = suggestSearchQuery.trim();
    if (!q) {
      setSuggestSearchResults([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        setIsSearchingSuggestions(true);
        const params = new URLSearchParams();
        params.set("search", q);
        let cityConstraint = "";
        if (selectedPlace?.city) {
          cityConstraint = selectedPlace.city.trim();
        } else {
          const [rawCity] = effectiveLocation.split(",");
          cityConstraint = (rawCity ?? "").trim();
        }
        if (cityConstraint) params.set("city", cityConstraint);
        const res = await fetch(`/api/attractions?${params.toString()}`);
        const data = (await res.json()) as { data?: ApiAttraction[]; attractions?: ApiAttraction[] };
        const rawAttractions = Array.isArray(data.data)
          ? data.data
          : Array.isArray(data.attractions)
            ? data.attractions
            : [];
        const filteredByCity = cityConstraint
          ? rawAttractions.filter(
              (attraction) => (attraction.city ?? "").trim().toLowerCase() === cityConstraint.toLowerCase()
            )
          : rawAttractions;
        if (!cancelled && filteredByCity.length > 0) {
          const mapped = filteredByCity.map(apiAttractionToFavorite);
          setSuggestSearchResults(mapped);
        } else if (!cancelled) {
          setSuggestSearchResults([]);
        }
      } catch {
        if (!cancelled) setSuggestSearchResults([]);
      } finally {
        if (!cancelled) setIsSearchingSuggestions(false);
      }
    }, 300);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [suggestSearchQuery, effectiveLocation]);

  useEffect(() => {
    if (!effectiveLocation) {
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
        if (selectedPlace?.city) {
          params.set("city", selectedPlace.city);
        } else {
          const [rawCity] = effectiveLocation.split(",");
          const cityLike = (rawCity ?? "").trim();
          if (cityLike) {
            params.set("city", cityLike);
          } else {
            params.set("search", effectiveLocation);
          }
        }
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
  }, [effectiveLocation, selectedPlace?.id, selectedPlace?.city]);

  useEffect(() => {
    const fallback = initialTripPlace ?? "";
    const sourcePlace = initialItinerary?.tripPlace ?? fallback;
    if (sourcePlace && !placeInputValue) {
      setPlaceInputValue(sourcePlace);
      setTripPlace(sourcePlace);
    }
  }, [initialItinerary?.tripPlace, initialTripPlace, placeInputValue]);

  useEffect(() => {
    const toMatch = initialItinerary?.tripPlace ?? initialTripPlace ?? "";
    if (!toMatch || placesOptions.length === 0) return;
    const match = placesOptions.find(
      (p) =>
        p.label === toMatch ||
        p.label.toLowerCase() === toMatch.toLowerCase() ||
        p.label.toLowerCase().startsWith(toMatch.toLowerCase())
    );
    if (match) {
      setSelectedPlace(match);
      setPlaceInputValue(match.label);
    }
  }, [initialItinerary?.tripPlace, initialTripPlace, placesOptions]);

  const filteredPlaces = useMemo(() => placesOptions.slice(0, 50), [placesOptions]);
  const filteredExtraPlaces = useMemo(() => extraPlacesOptions.slice(0, 50), [extraPlacesOptions]);

  useEffect(() => {
    const id =
      initialItinerary?.itineraryId
        ? sanitizeItineraryId(initialItinerary.itineraryId)
        : sanitizeItineraryId(itineraryIdFromRoute ?? "");
    if (!id) return;
    const url = `${window.location.origin}/solo-planner/${encodeURIComponent(id)}`;
    setShareLink(url);
    setActiveItineraryId(id);
  }, [initialItinerary?.itineraryId, itineraryIdFromRoute]);

  const OPEN_NEW_WITH_DESTINATIONS = "travel-app-open-new-with-destinations";
  const seededFromDestinationsRef = useRef(false);

  const resolvedId = sanitizeItineraryId(initialItinerary?.itineraryId ?? itineraryIdFromRoute ?? "");

  useEffect(() => {
    if (resolvedId) setCurrentItineraryId(resolvedId);
  }, [resolvedId]);

  /**
   * When switching itineraries (or creating new), reset the shared itinerary context.
   * If coming from "View itinerary" (Destinations), seed from cart. Else restore from persisted, or load from API, or clear.
   */
  useEffect(() => {
    const fromDestinations =
      typeof window !== "undefined" && window.sessionStorage.getItem(OPEN_NEW_WITH_DESTINATIONS) === "1";

    if (fromDestinations) {
      if (typeof window !== "undefined") window.sessionStorage.removeItem(OPEN_NEW_WITH_DESTINATIONS);
      clearAttractions();
      setExtraSuggestionSections([]);
      moveCartToItinerary(addAttraction);
      seededFromDestinationsRef.current = true;
      return;
    }

    if (seededFromDestinationsRef.current && !initialItinerary) {
      seededFromDestinationsRef.current = false;
      return;
    }
    if (initialItinerary) seededFromDestinationsRef.current = false;

    clearAttractions();
    if (!(initialItinerary?.extraPlaces?.length ?? 0)) {
      setExtraSuggestionSections([]);
    }

    const persisted = resolvedId ? loadWorkingItinerary(resolvedId) : null;
    if (initialItinerary) {
      setCollabVoteStats(initialItinerary.collabVoteStats);
      const all: FavoriteAttraction[] = [];
      for (const day of initialItinerary.days ?? []) {
        for (const stop of day.stops) all.push(stop.attraction);
      }
      for (const a of initialItinerary.unscheduled ?? []) all.push(a);
      all.forEach((a) => addAttraction(a));
      return;
    }
    if (persisted) {
      clearAttractions();
      const all: FavoriteAttraction[] = [];
      for (const day of persisted.days ?? []) {
        for (const stop of day.stops ?? []) all.push(stop.attraction);
      }
      for (const a of persisted.unscheduled ?? []) all.push(a);
      all.forEach((a) => addAttraction(a));
      setTripName(persisted.tripName ?? "");
      setTripPlace(persisted.tripPlace ?? "");
      setStartDate(persisted.startDate ?? "");
      setEndDate(persisted.endDate ?? "");
      setPace(persisted.pace ?? "balanced");
      setNotes(persisted.notes ?? "");
      setDayPlans(
        (persisted.days ?? []).map((d) => ({
          dayNumber: d.dayNumber,
          stops: (d.stops ?? []).map((s) => ({
            attraction: s.attraction,
            startTime: s.startTime ?? "09:00",
            durationMinutes: s.durationMinutes ?? 90
          }))
        }))
      );
      setUnscheduled(persisted.unscheduled ?? []);
      return;
    }
  }, [initialItinerary?.itineraryId, itineraryIdFromRoute, resolvedId, clearAttractions, moveCartToItinerary, addAttraction]);

  // Sync unscheduled so items added from Destinations (or elsewhere) appear in Unassigned (deduplicated by id).
  // When attractions is empty but current has items (e.g. initial load before addAttraction propagates),
  // preserve current to avoid wiping loaded data.
  useEffect(() => {
    const inDayIds = new Set(dayPlans.flatMap((d) => d.stops.map((s) => s.attraction.id)));
    const unassigned = attractions.filter((a) => !inDayIds.has(a.id));
    setUnscheduled((current) => {
      if (unassigned.length === 0 && current.length > 0) return current;
      const kept = current.filter((c) => unassigned.some((u) => u.id === c.id));
      const seenIds = new Set<number>();
      const dedupedKept = kept.filter((c) => {
        if (seenIds.has(c.id)) return false;
        seenIds.add(c.id);
        return true;
      });
      const toAppend = unassigned.filter((a) => !seenIds.has(a.id));
      if (toAppend.length === 0) return dedupedKept;
      return [...dedupedKept, ...toAppend];
    });
  }, [attractions, dayPlans]);

  const persistData = useCallback(() => {
    if (!resolvedId) return;
    saveWorkingItinerary({
      itineraryId: resolvedId,
      tripName,
      tripPlace,
      startDate,
      endDate,
      pace,
      notes,
      days: dayPlans.map((d) => ({
        dayNumber: d.dayNumber,
        stops: d.stops.map((s) => ({
          attraction: s.attraction,
          startTime: s.startTime ?? "09:00",
          durationMinutes: s.durationMinutes ?? 90
        }))
      })),
      unscheduled
    });
  }, [resolvedId, tripName, tripPlace, startDate, endDate, pace, notes, dayPlans, unscheduled]);

  useEffect(() => {
    if (!resolvedId) return;
    const timer = setTimeout(persistData, 200);
    return () => clearTimeout(timer);
  }, [resolvedId, persistData]);

  useEffect(() => {
    const onBeforeUnload = () => persistData();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [persistData]);

  const handleSelectPlace = useCallback((place: PlaceOption) => {
    setSelectedPlace(place);
    setTripPlace(place.label);
    setPlaceInputValue(place.label);
    setPlaceDropdownOpen(false);
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (placeDropdownRef.current && !placeDropdownRef.current.contains(target)) {
        setPlaceDropdownOpen(false);
      }
      if (extraPlaceDropdownRef.current && !extraPlaceDropdownRef.current.contains(target)) {
        setExtraPlaceDropdownOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Clear drag state when any drag ends (e.g. drop outside or cancel) so cards don't stay greyed
  useEffect(() => {
    const clearDrag = () => setDragSource(null);
    document.addEventListener("dragend", clearDrag);
    return () => document.removeEventListener("dragend", clearDrag);
  }, []);

  useEffect(() => {
    if (!calendarResizeState) return;
    const resizeState = calendarResizeState;

    function handleMouseMove(event: MouseEvent) {
      const deltaY = event.clientY - resizeState.startY;
      const stepDelta = Math.round(deltaY / SAMPLE_TRIAL_PX_PER_STEP);

      setDayPlans((current) =>
        current.map((day, dayIndex) => {
          if (dayIndex !== resizeState.dayIndex) return day;
          return {
            ...day,
            stops: day.stops.map((stop, slotIndex) => {
              if (slotIndex !== resizeState.slotIndex) return stop;
              const currentStartMinute = resizeState.initialStartMinute;
              const requestedDeltaMinutes = stepDelta * SAMPLE_TRIAL_STEP_MINUTES;

              if (resizeState.edge === "top") {
                const nextStartMinute = Math.max(
                  SAMPLE_TRIAL_START_MINUTE,
                  Math.min(
                    currentStartMinute + requestedDeltaMinutes,
                    currentStartMinute + resizeState.initialDuration - SAMPLE_TRIAL_STEP_MINUTES
                  )
                );
                return {
                  ...stop,
                  startTime: minutesToTime(nextStartMinute),
                  durationMinutes: resizeState.initialDuration - (nextStartMinute - currentStartMinute)
                };
              }

              const maxDuration = SAMPLE_TRIAL_END_MINUTE - currentStartMinute;
              const nextDuration = Math.max(
                SAMPLE_TRIAL_STEP_MINUTES,
                resizeState.initialDuration + requestedDeltaMinutes
              );
              return {
                ...stop,
                durationMinutes: Math.min(maxDuration, nextDuration)
              };
            })
          };
        })
      );
    }

    function handleMouseUp() {
      setCalendarResizeState(null);
    }

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [calendarResizeState]);

  type DropTarget =
    | { type: "day"; dayIndex: number; insertIndex: number }
    | { type: "unscheduled"; insertIndex: number };

  const moveStop = useCallback(
    (from: DragSource, to: DropTarget) => {
      let attraction: FavoriteAttraction;
      let startTime = "09:00";
      let durationMinutes = 90;

      if (from.type === "day") {
        const stop = dayPlans[from.dayIndex]?.stops[from.slotIndex];
        if (!stop) return;
        attraction = stop.attraction;
        startTime = stop.startTime || "09:00";
        durationMinutes = stop.durationMinutes || 90;
      } else if (from.type === "unscheduled") {
        const item = unscheduled[from.index];
        if (!item) return;
        attraction = item;
      } else {
        attraction = from.attraction;
        addAttraction(attraction);
      }

      setDayPlans((current) => {
        const next = current.map((d) => ({ ...d, stops: [...d.stops] }));
        while (next.length < tripDays) next.push({ dayNumber: next.length + 1, stops: [] });

        if (from.type === "day") {
          const day = next[from.dayIndex];
          if (day) day.stops.splice(from.slotIndex, 1);
        }

        if (to.type === "day" && to.dayIndex < next.length) {
          const targetDay = next[to.dayIndex];
          if (targetDay) {
            let insertIdx = to.insertIndex;
            if (from.type === "day" && from.dayIndex === to.dayIndex && from.slotIndex < to.insertIndex) {
              insertIdx = to.insertIndex - 1;
            }

            // Compute time: prefer keeping moved stop's time when it fits; else use smart default.
            const before = targetDay.stops[insertIdx - 1];
            const after = targetDay.stops[insertIdx];
            const defaultDuration = 90;
            const dur = from.type === "day" ? (durationMinutes || defaultDuration) : defaultDuration;
            durationMinutes = dur;

            const prevEndMin = before
              ? timeToMinutes(before.startTime || "09:00") + (before.durationMinutes || 90)
              : 0;
            const nextStartMin = after ? timeToMinutes(after.startTime || "09:00") : 24 * 60;
            const currentStartMin = from.type === "day" ? timeToMinutes(startTime || "09:00") : 0;
            const currentEndMin = currentStartMin + dur;
            const fits =
              from.type === "day" &&
              currentStartMin >= prevEndMin &&
              currentEndMin <= nextStartMin;

            if (fits) {
              startTime = startTime || "09:00";
            } else if (before && !after) {
              startTime = minutesToTime(prevEndMin);
            } else if (after && !before) {
              const nextStart = timeToMinutes(after.startTime || "09:00");
              startTime = minutesToTime(Math.max(9 * 60, nextStart - 120));
            } else if (after && before) {
              startTime = minutesToTime(prevEndMin);
            } else {
              startTime = "09:00";
            }

            const newStop: PlannedStop = { attraction, startTime, durationMinutes };
            targetDay.stops.splice(insertIdx, 0, newStop);
          }
        }
        return next.slice(0, tripDays);
      });

      setUnscheduled((current) => {
        if (from.type === "unscheduled") {
          const next = current.filter((_, i) => i !== from.index);
          if (to.type === "unscheduled") {
            let insertIdx = to.insertIndex;
            if (from.index < to.insertIndex) insertIdx = to.insertIndex - 1;
            next.splice(insertIdx, 0, attraction);
            return next;
          }
          return next;
        }
        if (from.type === "suggested") {
          if (to.type !== "unscheduled") return current;
          if (current.some((item) => item.id === attraction.id)) return current;
          const next = [...current];
          next.splice(Math.min(to.insertIndex, next.length), 0, attraction);
          return next;
        }
        if (to.type === "unscheduled") {
          const next = [...current];
          if (next.some((item) => item.id === attraction.id)) return next;
          next.splice(Math.min(to.insertIndex, next.length), 0, attraction);
          return next;
        }
        return current;
      });
      setDragSource(null);
    },
    [addAttraction, dayPlans, unscheduled, tripDays]
  );

  const clearPlan = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Clear schedule and start fresh? This will remove all places and the trip location.");
      if (!confirmed) return;
    }
    clearAttractions();
    setDayPlans([]);
    setUnscheduled([]);
    setNotes("");
    setTripName("");
    setTripPlace("");
    setSelectedPlace(null);
    setPlaceInputValue("");
    setExtraSuggestionSections([]);
    hasBeenSavedRef.current = false;
    setShareLink(null);
    setShareCode(null);
    const currentId = activeItineraryId || resolvedId;
    if (currentId) clearWorkingItinerary(currentId);
    setCurrentItineraryId(null);
    if (embedded) {
      router.replace("/solo-planner", undefined, { shallow: false });
    }
  };

  /** Remove an attraction from the entire itinerary (context, unscheduled, all days). Use for every remove action. */
  const removeFromItinerary = useCallback((attractionId: number) => {
    const previousUnscheduled = unscheduled;
    const previousDayPlans = dayPlans;
    const removedAttraction =
      previousUnscheduled.find((item) => item.id === attractionId) ??
      previousDayPlans.flatMap((day) => day.stops.map((stop) => stop.attraction)).find((item) => item.id === attractionId) ??
      attractions.find((item) => item.id === attractionId) ??
      null;
    removeAttraction(attractionId);
    setUnscheduled((c) => c.filter((x) => x.id !== attractionId));
    setDayPlans((c) => c.map((d) => ({ ...d, stops: d.stops.filter((s) => s.attraction.id !== attractionId) })));
    if (removedAttraction) {
      addUndo(`Removed ${removedAttraction.name}`, () => {
        addAttraction(removedAttraction);
        setUnscheduled(previousUnscheduled);
        setDayPlans(previousDayPlans);
      });
    }
  }, [addAttraction, addUndo, attractions, dayPlans, removeAttraction, unscheduled]);

  const removeExtraLocation = useCallback((sectionId: string) => {
    const removed = extraSuggestionSections.find((section) => section.id === sectionId);
    if (!removed) return;
    setExtraSuggestionSections((current) => current.filter((section) => section.id !== sectionId));
    addUndo(`Removed ${removed.label}`, () => {
      setExtraSuggestionSections((current) =>
        current.some((section) => section.id === removed.id) ? current : [...current, removed]
      );
    });
  }, [addUndo, extraSuggestionSections]);

  const addToItineraryPool = useCallback(
    (attraction: FavoriteAttraction) => {
      addAttraction(attraction);
      setUnscheduled((current) =>
        current.some((item) => item.id === attraction.id) ? current : [...current, attraction]
      );
    },
    [addAttraction]
  );

  const openCustomEventEditDialog = useCallback((eventId: number, currentName: string, currentDuration: number) => {
    setCustomEventDialog({ mode: "edit", eventId });
    setCustomEventDialogName(currentName);
    setCustomEventDialogDuration(currentDuration || 90);
  }, []);

  const closeCustomEventDialog = useCallback(() => {
    setCustomEventDialog(null);
    setCustomEventDialogName("");
    setCustomEventDialogDuration(90);
  }, []);

  const addCustomEventToCalendar = useCallback(
    (dayIndex: number, requestedMinute: number, name: string, durationMinutes: number) => {
      const attraction = createCustomEvent(name.trim());
      addAttraction(attraction);
      setCustomDurationByAttractionId((current) => ({
        ...current,
        [attraction.id]: durationMinutes
      }));
      const roundedMinute =
        Math.round((requestedMinute - SAMPLE_TRIAL_START_MINUTE) / SAMPLE_TRIAL_STEP_MINUTES) *
          SAMPLE_TRIAL_STEP_MINUTES +
        SAMPLE_TRIAL_START_MINUTE;
      const safeStartMinute = Math.max(
        SAMPLE_TRIAL_START_MINUTE,
        Math.min(SAMPLE_TRIAL_END_MINUTE - SAMPLE_TRIAL_STEP_MINUTES, roundedMinute)
      );

      setDayPlans((current) => {
        const next = current.map((day) => ({ ...day, stops: [...day.stops] }));
        while (next.length < tripDays) next.push({ dayNumber: next.length + 1, stops: [] });
        const targetDay = next[dayIndex];
        if (!targetDay) return next.slice(0, tripDays);

        const nextStartMinute = Math.min(safeStartMinute, SAMPLE_TRIAL_END_MINUTE - durationMinutes);
        const newStop: PlannedStop = {
          attraction,
          startTime: minutesToTime(nextStartMinute),
          durationMinutes
        };
        const insertIndex = targetDay.stops.findIndex(
          (stop) => timeToMinutes(stop.startTime || "09:00") > nextStartMinute
        );
        if (insertIndex === -1) targetDay.stops.push(newStop);
        else targetDay.stops.splice(insertIndex, 0, newStop);
        return next.slice(0, tripDays);
      });
    },
    [addAttraction, tripDays]
  );

  const handleSaveCustomEventDialog = useCallback(() => {
    const trimmed = customEventDialogName.trim();
    if (!trimmed || !customEventDialog) return;

    if (customEventDialog.mode === "create") {
      if (
        typeof customEventDialog.dayIndex === "number" &&
        typeof customEventDialog.requestedMinute === "number"
      ) {
        addCustomEventToCalendar(
          customEventDialog.dayIndex,
          customEventDialog.requestedMinute,
          trimmed,
          customEventDialogDuration
        );
      } else {
        const attraction = createCustomEvent(trimmed);
        setCustomDurationByAttractionId((current) => ({
          ...current,
          [attraction.id]: customEventDialogDuration
        }));
        addToItineraryPool(attraction);
      }
      closeCustomEventDialog();
      return;
    }

    setDayPlans((current) =>
      current.map((day) => ({
        ...day,
        stops: day.stops.map((stop) =>
          stop.attraction.id === customEventDialog.eventId
            ? {
                ...stop,
                attraction: { ...stop.attraction, name: trimmed },
                durationMinutes: customEventDialogDuration
              }
            : stop
        )
      }))
    );
    setUnscheduled((current) =>
      current.map((attraction) =>
        attraction.id === customEventDialog.eventId ? { ...attraction, name: trimmed } : attraction
      )
    );
    setCustomDurationByAttractionId((current) => ({
      ...current,
      [customEventDialog.eventId]: customEventDialogDuration
    }));
    closeCustomEventDialog();
  }, [addCustomEventToCalendar, addToItineraryPool, closeCustomEventDialog, customEventDialog, customEventDialogDuration, customEventDialogName]);

  const moveStopToCalendar = useCallback(
    (from: DragSource, dayIndex: number, requestedMinute: number) => {
      let attraction: FavoriteAttraction;
      let durationMinutes = SAMPLE_TRIAL_DEFAULT_DURATION;

      if (from.type === "day") {
        const stop = dayPlans[from.dayIndex]?.stops[from.slotIndex];
        if (!stop) return;
        attraction = stop.attraction;
        durationMinutes = stop.durationMinutes || SAMPLE_TRIAL_DEFAULT_DURATION;
      } else if (from.type === "unscheduled") {
        const item = unscheduled[from.index];
        if (!item) return;
        attraction = item;
        if (isCustomEvent(item)) {
          durationMinutes = customDurationByAttractionId[item.id] ?? SAMPLE_TRIAL_DEFAULT_DURATION;
        }
      } else {
        attraction = from.attraction;
        addAttraction(attraction);
      }

      const roundedMinute =
        Math.round((requestedMinute - SAMPLE_TRIAL_START_MINUTE) / SAMPLE_TRIAL_STEP_MINUTES) *
          SAMPLE_TRIAL_STEP_MINUTES +
        SAMPLE_TRIAL_START_MINUTE;
      const safeStartMinute = Math.max(
        SAMPLE_TRIAL_START_MINUTE,
        Math.min(SAMPLE_TRIAL_END_MINUTE - SAMPLE_TRIAL_STEP_MINUTES, roundedMinute)
      );

      setDayPlans((current) => {
        const next = current.map((day) => ({ ...day, stops: [...day.stops] }));
        while (next.length < tripDays) next.push({ dayNumber: next.length + 1, stops: [] });

        if (from.type === "day") {
          const sourceDay = next[from.dayIndex];
          if (!sourceDay) return current;
          sourceDay.stops.splice(from.slotIndex, 1);
        }

        const targetDay = next[dayIndex];
        if (!targetDay) return next.slice(0, tripDays);

        const nextStartMinute = Math.min(safeStartMinute, SAMPLE_TRIAL_END_MINUTE - durationMinutes);
        const newStop: PlannedStop = {
          attraction,
          startTime: minutesToTime(nextStartMinute),
          durationMinutes
        };

        const insertIndex = targetDay.stops.findIndex(
          (stop) => timeToMinutes(stop.startTime || "09:00") > nextStartMinute
        );

        if (insertIndex === -1) {
          targetDay.stops.push(newStop);
        } else {
          targetDay.stops.splice(insertIndex, 0, newStop);
        }

        return next.slice(0, tripDays);
      });
      setUnscheduled((current) =>
        from.type === "unscheduled" ? current.filter((_, index) => index !== from.index) : current
      );
      setDragSource(null);
    },
    [addAttraction, customDurationByAttractionId, dayPlans, tripDays, unscheduled]
  );

  const getCalendarDateLabel = useCallback(
    (dayIndex: number) => {
      const baseDate = parseLocalDateIso(startDate) ?? new Date();
      const date = new Date(baseDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
      return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    },
    [startDate]
  );

  async function handleSave(event?: FormEvent) {
    if (event) event.preventDefault();

    const isExisting =
      !!initialItinerary || hasBeenSavedRef.current;
    const isNewTrip = !isExisting;

    setIsSaving(true);
    setSaveError(null);
    setIsShareCopied(false);
    setIsShareCodeCopied(false);

    const extraPlacesPayload: ExtraPlaceItem[] = extraSuggestionSections
      .filter((s) => s.label?.trim())
      .map((s) => {
        const label = s.label.trim();
        const parts = label.split(",").map((p) => p.trim());
        const city = parts[0] ?? "";
        const countryRegion = parts.slice(1).join(", ").trim() || "";
        return {
          placeId: undefined,
          label,
          city,
          countryRegion
        };
      });

    const payload: any = {
      itineraryId: activeItineraryId || undefined,
      userId: user?.id ?? undefined,
      tripName: activeTripName,
      tripPlace: tripPlace.trim(),
      placeId: selectedPlace?.id ?? undefined,
      extraPlaces: extraPlacesPayload,
      startDate,
      endDate,
      pace,
      notes,
      days: dayPlansRef.current,
      unscheduled
    };

    try {
      const response = await fetch("/api/itinerary", {
        method: isExisting ? "PATCH" : "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const data = (await response.json()) as {
        itineraryId?: string;
        path?: string;
        shareCode?: string;
        error?: string;
      };

      if (!response.ok || !data.itineraryId || !data.path) {
        throw new Error(data.error || "Failed to save itinerary.");
      }

      const sanitizedId = sanitizeItineraryId(data.itineraryId);
      const fullShareLink = `${window.location.origin}${data.path}`;

      setActiveItineraryId(sanitizedId);
      setShareLink(fullShareLink);
      hasBeenSavedRef.current = true;
      clearWorkingItinerary(sanitizedId);

      if (data.shareCode) {
        setShareCode(data.shareCode);
      }

      if (isNewTrip && !embedded) {
        clearAttractions();
      }

      if (!embedded) {
        const currentPath = router.asPath;
        if (!currentPath.includes(`/solo-planner/${sanitizedId}`)) {
          router.push(`/solo-planner/${encodeURIComponent(sanitizedId)}`, undefined, {
            shallow: false
          });
        }
      }
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Unknown error saving itinerary.");
    } finally {
      setIsSaving(false);
    }
  }

  const handleSaveRef = useRef(handleSave);
  handleSaveRef.current = handleSave;

  useImperativeHandle(
    ref,
    () => ({
      save: () => handleSaveRef.current(),
      get isSaving() {
        return isSaving;
      },
      get hasBeenSaved() {
        return hasBeenSavedRef.current;
      }
    }),
    [isSaving]
  );

  /** Debounced auto-save when embedded with an itinerary ID (e.g. solo-planner) */
  const autoSaveDeps = [
    dayPlans,
    unscheduled,
    tripName,
    startDate,
    endDate,
    pace,
    tripPlace,
    placeInputValue,
    selectedPlace?.id,
    notes,
    extraSuggestionSections.map((s) => s.label).join(",")
  ];
  const isFirstMountRef = useRef(true);
  useEffect(() => {
    if (!embedded || !activeItineraryId || !hasBeenSavedRef.current) return;
    if (isFirstMountRef.current) {
      isFirstMountRef.current = false;
      return;
    }
    const timer = setTimeout(() => {
      void handleSaveRef.current();
    }, 1500);
    return () => clearTimeout(timer);
  }, autoSaveDeps);

  async function handleExportIcs() {
    if (!startDate || dayPlans.length === 0) return;

    const events: string[] = [];
    const baseTitle = activeTripName || "Trip";
    const cleanedTitle = baseTitle.replace(/\r?\n/g, " ").trim();

    for (const day of dayPlans) {
      if (!day.stops.length) continue;
      const dayIndex = day.dayNumber - 1;
      const baseDate = parseLocalDateIso(startDate) ?? new Date(startDate);
      if (Number.isNaN(baseDate.getTime())) continue;
      const eventDate = new Date(baseDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
      const datePart = formatDateForIcs(eventDate);

      const stops = day.stops
        .slice()
        .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""));

      for (let i = 0; i < stops.length; i++) {
        const stop = stops[i];
        const a = stop.attraction;

        const timeMatch = (stop.startTime || "09:00").match(/^(\d{2}):(\d{2})$/);
        let startHour = 9;
        let startMinute = 0;
        if (timeMatch) {
          startHour = Number(timeMatch[1]);
          startMinute = Number(timeMatch[2]);
        }

        const durationMinutes = stop.durationMinutes && stop.durationMinutes > 0 ? stop.durationMinutes : 60;
        const startTime = formatTimeForIcs(startHour, startMinute);
        let totalMinutes = startHour * 60 + startMinute + durationMinutes;
        let endHour = Math.floor(totalMinutes / 60);
        let endMinute = totalMinutes % 60;
        const endTime = formatTimeForIcs(endHour, endMinute);

        const summary = `${cleanedTitle} - ${a.name}`.replace(/[\r\n]+/g, " ");
        const locationParts = [a.name, a.city, a.stateProvince, a.country].filter(Boolean);
        const location = locationParts.join(", ").replace(/[\r\n]+/g, " ");

        events.push(
          "BEGIN:VEVENT",
          `UID:${a.id}-${day.dayNumber}-${i}@travelapp`,
          `DTSTAMP:${formatDateForIcs(new Date())}T000000`,
          `DTSTART:${datePart}T${startTime}`,
          `DTEND:${datePart}T${endTime}`,
          `SUMMARY:${summary}`,
          location ? `LOCATION:${location}` : "",
          "END:VEVENT"
        );
      }
    }

    if (events.length === 0) return;

    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//TravelApp//Itinerary Export//EN",
      ...events.filter(Boolean),
      "END:VCALENDAR"
    ];

    const icsContent = lines.join("\r\n");
    const blob = new Blob([icsContent], { type: "text/calendar;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    const safeTitle = cleanedTitle || "itinerary";
    link.href = url;
    link.download = `${safeTitle.replace(/[^a-z0-9_-]+/gi, "-").slice(0, 60) || "itinerary"}.ics`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  function handleExportPdf() {
    const tripTitle = activeTripName || "Trip Itinerary";
    const daySections = paddedDayPlans
      .map((day) => {
        const stops = day.stops
          .slice()
          .sort((a, b) => (a.startTime || "").localeCompare(b.startTime || ""))
          .map((stop) => {
            const name = escapeHtml(stop.attraction.name || "Untitled stop");
            const time = escapeHtml(formatTimeLabel(stop.startTime, stop.durationMinutes));
            const location = escapeHtml(
              formatLocation(
                stop.attraction.city,
                stop.attraction.stateProvince,
                stop.attraction.country
              )
            );
            return `<li><strong>${name}</strong><br /><span>${time} - ${location}</span></li>`;
          })
          .join("");
        return `<section><h2>Day ${day.dayNumber}</h2>${
          stops ? `<ul>${stops}</ul>` : "<p>No scheduled stops.</p>"
        }</section>`;
      })
      .join("");

    const unscheduledItems = unscheduled
      .map((item) => `<li>${escapeHtml(item.name || "Untitled stop")}</li>`)
      .join("");

    const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(tripTitle)} - Itinerary</title>
    <style>
      body { font-family: Arial, sans-serif; margin: 24px; color: #1f2933; }
      h1 { margin: 0 0 12px; }
      h2 { margin: 18px 0 8px; font-size: 18px; }
      p { margin: 6px 0; }
      ul { margin: 8px 0 0 18px; padding: 0; }
      li { margin: 8px 0; }
      span { color: #52606d; font-size: 14px; }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(tripTitle)}</h1>
    <p><strong>Dates:</strong> ${escapeHtml(startDate)} to ${escapeHtml(endDate)}</p>
    ${daySections}
    <section>
      <h2>Unassigned</h2>
      ${unscheduledItems ? `<ul>${unscheduledItems}</ul>` : "<p>No unassigned items.</p>"}
    </section>
  </body>
</html>`;

    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      window.alert("Please allow pop-ups to export as PDF.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    const runPrint = () => {
      printWindow.focus();
      printWindow.print();
    };
    if (printWindow.document.readyState === "complete") {
      runPrint();
    } else {
      printWindow.onload = runPrint;
    }
  }

  async function handleAddExtraLocationForSection(
    sectionId: string,
    place: PlaceOption
  ) {
    const label = place.label?.trim();
    if (!label) return;
    let cancelled = false;
    try {
      const params = new URLSearchParams();
      params.set("limit", String(SUGGESTED_LIMIT));
      params.set("offset", "0");
      const city = place.city?.trim() || null;
      const countryRegion = place.countryRegion?.trim() || null;
      if (city) params.set("city", city);
      if (countryRegion) params.set("countryRegion", countryRegion);
      if (!city) {
        const [rawCity] = label.split(",");
        const cityLike = (rawCity ?? "").trim();
        if (cityLike) params.set("city", cityLike);
        else if (!countryRegion) params.set("search", label);
      }
      const res = await fetch(`/api/attractions?${params.toString()}`);
      const json = (await res.json()) as { data?: ApiAttraction[]; error?: string };
      if (!cancelled && json.data) {
        const favorites = json.data.map(apiAttractionToFavorite);
        setExtraSuggestionSections((prev) =>
          prev.map((s) =>
            s.id === sectionId ? { ...s, attractions: favorites, loading: false } : s
          )
        );
      } else if (!cancelled) {
        setExtraSuggestionSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, attractions: [], loading: false } : s))
        );
      }
    } catch {
      if (!cancelled) {
        setExtraSuggestionSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, attractions: [], loading: false } : s))
        );
      }
    }
  }

  async function handleAddExtraLocation(override?: string | PlaceOption) {
    const label =
      typeof override === "object"
        ? override.label
        : (override ?? newSuggestionLocation.trim()).trim();
    if (!label) return;

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setExtraSuggestionSections((current) => [
      ...current,
      { id, label, attractions: [], loading: true, collapsed: false }
    ]);
    setNewSuggestionLocation("");
    setExtraPlaceDropdownOpen(false);
    setAddLocationExpanded(false);

    const sectionId = id;
    let cancelled = false;
    try {
      const params = new URLSearchParams();
      params.set("limit", String(SUGGESTED_LIMIT));
      params.set("offset", "0");
      const city = typeof override === "object" && override.city ? override.city.trim() : null;
      const countryRegion =
        typeof override === "object" && override.countryRegion ? override.countryRegion.trim() : null;
      if (city) {
        params.set("city", city);
      }
      if (countryRegion) {
        params.set("countryRegion", countryRegion);
      }
      if (!city) {
        const [rawCity] = label.split(",");
        const cityLike = (rawCity ?? "").trim();
        if (cityLike) {
          params.set("city", cityLike);
        } else if (!countryRegion) {
          params.set("search", label);
        }
      }
      const res = await fetch(`/api/attractions?${params.toString()}`);
      const json = (await res.json()) as { data?: ApiAttraction[]; error?: string };
      if (!cancelled && json.data) {
        const favorites = json.data.map(apiAttractionToFavorite);
        setExtraSuggestionSections((prev) =>
          prev.map((s) =>
            s.id === sectionId ? { ...s, attractions: favorites, loading: false } : s
          )
        );
      } else if (!cancelled) {
        setExtraSuggestionSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, attractions: [], loading: false } : s))
        );
      }
    } catch {
      if (!cancelled) {
        setExtraSuggestionSections((prev) =>
          prev.map((s) => (s.id === sectionId ? { ...s, attractions: [], loading: false } : s))
        );
      }
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

  async function handleCopyShareCode() {
    if (!shareCode) return;
    try {
      await navigator.clipboard.writeText(shareCode);
    } catch {
      // ignore copy failures
    }
    setIsShareCodeCopied(true);
  }

  const hasSuggestionPanels = Boolean(effectiveLocation) || extraSuggestionSections.length > 0;
  const visiblePrimarySuggestions = useMemo(() => {
    const source = suggestSearchQuery ? suggestSearchResults : suggestedAttractions;
    return filterAndSortAttractions(
      source,
      suggestSearchQuery,
      suggestSortBy,
      suggestMaxPriceLevel,
      suggestCategoryFilter
    );
  }, [
    suggestSearchQuery,
    suggestSearchResults,
    suggestedAttractions,
    suggestSortBy,
    suggestMaxPriceLevel,
    suggestCategoryFilter
  ]);
  const suggestionCategoryOptions = useMemo(() => {
    const source = suggestSearchQuery ? suggestSearchResults : suggestedAttractions;
    const categories = new Set<string>();
    for (const attraction of source) {
      for (const category of attraction.categories ?? []) {
        const normalized = category.trim();
        if (normalized) categories.add(normalized);
      }
    }
    return Array.from(categories).sort((a, b) => a.localeCompare(b));
  }, [suggestSearchQuery, suggestSearchResults, suggestedAttractions]);

  function renderSuggestedCard(attraction: FavoriteAttraction) {
    const added = isInItinerary(attraction.id);
    const isDraggingSuggested =
      dragSource?.type === "suggested" && dragSource.attraction.id === attraction.id;

    return (
      <article
        className={`saved-suggested-card saved-suggested-card-clickable${!added ? " saved-suggested-card-draggable" : ""}${
          isDraggingSuggested ? " saved-suggested-card-dragging" : ""
        }`}
        key={attraction.id}
        draggable={!added}
        onClick={() => openAttractionDetails(attraction)}
        onDragStart={() => {
          if (!added) setDragSource({ type: "suggested", attraction });
        }}
        onDragEnd={() => setDragSource(null)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            openAttractionDetails(attraction);
          }
        }}
      >
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
          <p className="saved-suggested-card-meta">{getAttractionMeta(attraction)}</p>
          {attraction.summary && (
            <p className="saved-suggested-card-summary">
              {attraction.summary.slice(0, 120)}
              {attraction.summary.length > 120 ? "…" : ""}
            </p>
          )}
          {added ? (
            <div className="saved-suggested-action-row">
              <span className="saved-suggested-added-badge" aria-label={`${attraction.name} added to itinerary`}>
                ✓ Added
              </span>
              <button
                type="button"
                className="saved-suggested-remove"
                aria-label={`Remove ${attraction.name} from itinerary`}
                onClick={(e) => {
                  e.stopPropagation();
                  removeFromItinerary(attraction.id);
                }}
              >
                ×
              </button>
            </div>
          ) : (
            <button
              type="button"
              className="saved-suggested-add"
              aria-label={`Add ${attraction.name} to itinerary`}
              onClick={(e) => {
                e.stopPropagation();
                addToItineraryPool(attraction);
              }}
            >
              + Add
            </button>
          )}
        </div>
      </article>
    );
  }

  function openAttractionDetails(attraction: FavoriteAttraction) {
    if (isCustomEvent(attraction)) return;
    setSelectedAttraction(attraction);
  }

  const body = (
    <div className={`saved-trips-content${embedded ? " saved-trips-content-embedded" : ""}`}>
          <section className="saved-trips-header">
            <div>
              <h1>Itinerary Builder</h1>
              <p className="saved-trips-header-subtitle">
                Turn your favorites into a ready-to-go itinerary in one click and save it with a shareable link.
              </p>
            </div>
            <div className="saved-trips-header-actions">
              <div className="saved-trips-share-dropdown">
                <button
                  type="button"
                  className="saved-trips-button saved-trips-header-action"
                  onClick={() => setExportMenuOpen((open) => !open)}
                >
                  <span>Export</span>
                  <span className="saved-trips-share-caret" aria-hidden="true">
                    ▾
                  </span>
                </button>
                {exportMenuOpen && (
                  <div className="saved-trips-share-menu">
                    <button
                      type="button"
                      className="saved-trips-share-menu-item"
                      onClick={() => {
                        void handleExportIcs();
                        setExportMenuOpen(false);
                      }}
                    >
                      Export as iCal (.ics)
                    </button>
                    <button
                      type="button"
                      className="saved-trips-share-menu-item"
                      onClick={() => {
                        handleExportPdf();
                        setExportMenuOpen(false);
                      }}
                    >
                      Export as PDF
                    </button>
                  </div>
                )}
              </div>
              {(shareLink || (user?.id && shareCode)) && (
                <div className="saved-trips-share-dropdown">
                  <button
                    type="button"
                    className="saved-trips-button saved-trips-header-action"
                    onClick={() => setShareMenuOpen((open) => !open)}
                  >
                    <span>Share</span>
                    <span className="saved-trips-share-caret" aria-hidden="true">
                      ▾
                    </span>
                  </button>
                  {shareMenuOpen && (
                    <div className="saved-trips-share-menu">
                      {shareLink && (
                        <button
                          type="button"
                          className="saved-trips-share-menu-item"
                          onClick={() => {
                            void handleCopyShareLink();
                            setShareMenuOpen(false);
                          }}
                        >
                          {isShareCopied ? "Link Copied!" : "Copy share link"}
                        </button>
                      )}
                      {user?.id && shareCode && (
                        <button
                          type="button"
                          className="saved-trips-share-menu-item"
                          onClick={() => {
                            void handleCopyShareCode();
                            setShareMenuOpen(false);
                          }}
                        >
                          {isShareCodeCopied ? "Code Copied!" : "Copy share code"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </section>

          <section className="saved-trips-top-layout">
            <form className="saved-trips-builder" onSubmit={handleSave}>
              <div className="saved-trips-builder-top-row">
                <div className="saved-trips-field saved-trips-field-compact saved-trips-field-trip-name">
                  <label htmlFor="trip-name">Trip Name</label>
                  <input
                    id="trip-name"
                    type="text"
                    value={tripName}
                    onChange={(event) => setTripName(event.target.value)}
                    placeholder="Give your trip a name"
                  />
                </div>
                <div className="saved-trips-field saved-trips-field-date">
                  <label htmlFor="trip-start">Start</label>
                  <input
                    id="trip-start"
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </div>
                <div className="saved-trips-field saved-trips-field-date">
                  <label htmlFor="trip-end">End</label>
                  <input
                    id="trip-end"
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </div>
              </div>
              <div className="saved-trips-field saved-trips-field-full saved-trips-field-stack saved-trips-field-location">
                <label htmlFor="trip-place">Trip location</label>
                <div ref={placeDropdownRef} className="saved-trips-field-place">
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
                {extraSuggestionSections.map((section) => (
                  <div key={section.id} className="saved-trips-extra-location-row">
                    <input
                      type="text"
                      readOnly
                      value={section.label}
                      className="planning-solo-input"
                      aria-label={`Additional location: ${section.label}`}
                    />
                    <button
                      type="button"
                      className="saved-schedule-card-remove"
                      aria-label={`Remove ${section.label}`}
                      onClick={() => removeExtraLocation(section.id)}
                    >
                      <img
                        src="https://img.icons8.com/fluent-systems-regular/24/FA5252/trash.png"
                        alt=""
                        width={18}
                        height={18}
                        className="saved-schedule-card-remove-icon"
                      />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="saved-trips-add-location-trigger"
                  onClick={() => setAddLocationExpanded((e) => !e)}
                >
                  <span aria-hidden style={{ fontSize: "1.2em" }}>{addLocationExpanded ? "−" : "+"}</span>
                  <span>Add another Location</span>
                </button>
                {addLocationExpanded && (
                  <div className="saved-trips-field-place saved-trips-extra-location-editor" ref={extraPlaceDropdownRef}>
                    <div className="planning-solo-input-row saved-trips-extra-location-controls">
                      <input
                        id="extra-location-input"
                        className="planning-solo-input"
                        type="text"
                        value={newSuggestionLocation}
                        onChange={(e) => {
                          setNewSuggestionLocation(e.target.value);
                          setExtraPlaceDropdownOpen(true);
                        }}
                        onFocus={() => setExtraPlaceDropdownOpen(true)}
                        onBlur={() => setTimeout(() => setExtraPlaceDropdownOpen(false), 180)}
                        placeholder="Type to search destinations…"
                        autoComplete="off"
                      />
                      <div className="saved-trips-inline-actions">
                        <button
                          type="button"
                          className="planning-solo-next"
                          onClick={() => handleAddExtraLocation()}
                        >
                          Add Location
                        </button>
                        <button
                          type="button"
                          className="saved-trips-button saved-trips-button-muted"
                          onClick={() => {
                            setAddLocationExpanded(false);
                            setNewSuggestionLocation("");
                            setExtraPlaceDropdownOpen(false);
                          }}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                    {extraPlaceDropdownOpen && (
                      <ul
                        className="saved-trips-place-listbox"
                        role="listbox"
                        aria-label="Available destinations for suggestions"
                        style={{ maxHeight: 200, overflowY: "auto" }}
                      >
                        {filteredExtraPlaces.length === 0 ? (
                          <li className="saved-trips-place-option saved-trips-place-option-empty" role="option">
                            No matching places
                          </li>
                        ) : (
                          filteredExtraPlaces.map((p) => (
                            <li
                              key={p.id}
                              role="option"
                              className="saved-trips-place-option"
                              onMouseDown={(e) => {
                                e.preventDefault();
                                handleAddExtraLocation(p);
                              }}
                            >
                              {p.label}
                            </li>
                          ))
                        )}
                      </ul>
                    )}
                  </div>
                )}
              </div>
              <div className="saved-trips-actions">
                <button type="button" className="saved-trips-button saved-trips-button-muted" onClick={clearPlan}>
                  Clear schedule
                </button>
              </div>
            </form>

            <section className="saved-trips-notes saved-trips-notes-panel">
              <label htmlFor="trip-notes">Trip Notes</label>
              <textarea
                id="trip-notes"
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
                placeholder="Add reminders: reservations, neighborhood plans, must-eat spots..."
                rows={3}
              />
            </section>
          </section>

          <section className="saved-trips-planner-layout">
              <div className="saved-trips-suggestions-column">
                {!hasSuggestionPanels && (
                  <section className="saved-suggested-section saved-suggested-section-empty">
                    <h2>Attractions</h2>
                    <p className="saved-suggested-empty-message">
                      Select a destination to view attractions to add to the calendar.
                    </p>
                  </section>
                )}

                {effectiveLocation && (
                  <section className="saved-suggested-section" aria-labelledby="suggested-heading">
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8
                      }}
                    >
                      <h2 id="suggested-heading">Suggested in {effectiveLocation}</h2>
                      <button
                        type="button"
                        className="saved-trips-button saved-trips-button-muted"
                        onClick={() => setPrimarySuggestionsCollapsed((c) => !c)}
                      >
                        {primarySuggestionsCollapsed ? "Show" : "Hide"}
                      </button>
                    </div>
                    {!primarySuggestionsCollapsed && (
                      <>
                        <p className="saved-suggested-intro">Scroll this list and drag any attraction onto the calendar.</p>
                        <div className="saved-trips-field saved-trips-field-full" style={{ marginTop: 8 }}>
                          <label htmlFor="saved-suggested-search">Search attractions</label>
                          <input
                            id="saved-suggested-search"
                            type="text"
                            value={suggestSearchQuery}
                            onChange={(e) => setSuggestSearchQuery(e.target.value)}
                            className="planning-solo-input"
                            placeholder="Search by name or keyword…"
                          />
                        </div>
                        <div
                          className="saved-trips-field saved-trips-field-full"
                          style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
                        >
                          <div>
                            <label htmlFor="saved-suggested-sort">Sort</label>
                            <select
                              id="saved-suggested-sort"
                              value={suggestSortBy}
                              onChange={(e) => setSuggestSortBy(e.target.value as SuggestSort)}
                            >
                              <option value="name-asc">Name (A-Z)</option>
                              <option value="category-asc">Category (A-Z)</option>
                              <option value="rating-desc">Highest rating</option>
                              <option value="popularity-desc">Most popular</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor="saved-suggested-category">Category</label>
                            <select
                              id="saved-suggested-category"
                              value={suggestCategoryFilter}
                              onChange={(e) => setSuggestCategoryFilter(e.target.value)}
                            >
                              <option value="all">All categories</option>
                              {suggestionCategoryOptions.map((category) => (
                                <option key={category} value={category.toLowerCase()}>
                                  {category}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor="saved-suggested-price">Max cost</label>
                            <select
                              id="saved-suggested-price"
                              value={suggestMaxPriceLevel}
                              onChange={(e) => setSuggestMaxPriceLevel(e.target.value)}
                            >
                              <option value="0">All</option>
                              <option value="1">$</option>
                              <option value="2">$$</option>
                              <option value="3">$$$</option>
                              <option value="4">$$$$</option>
                            </select>
                          </div>
                        </div>
                        {loadingSuggested && !suggestSearchQuery ? (
                          <p className="saved-suggested-loading">Loading suggestions…</p>
                        ) : isSearchingSuggestions ? (
                          <p className="saved-suggested-loading">Searching…</p>
                        ) : (
                          <div className="saved-suggested-grid">
                            {visiblePrimarySuggestions.map(renderSuggestedCard)}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                )}

                {extraSuggestionSections.map((section) => (
                  <section
                    key={section.id}
                    className="saved-suggested-section"
                    aria-label={`Suggested in ${section.label}`}
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8
                      }}
                    >
                      <h2>Suggested in {section.label}</h2>
                      <button
                        type="button"
                        className="saved-trips-button saved-trips-button-muted"
                        onClick={() =>
                          setExtraSuggestionSections((current) =>
                            current.map((s) =>
                              s.id === section.id ? { ...s, collapsed: !s.collapsed } : s
                            )
                          )
                        }
                      >
                        {section.collapsed ? "Show" : "Hide"}
                      </button>
                    </div>
                    {!section.collapsed && (
                      <>
                        <div className="saved-trips-field saved-trips-field-full" style={{ marginTop: 8 }}>
                          <label htmlFor={`extra-suggested-search-${section.id}`}>
                            Search attractions in {section.label}
                          </label>
                          <input
                            id={`extra-suggested-search-${section.id}`}
                            type="text"
                            className="planning-solo-input"
                            placeholder="Search by name or keyword…"
                            value={section.searchQuery ?? ""}
                            onChange={(e) => updateSectionSearch(section.id, e.target.value)}
                          />
                        </div>
                        <div
                          className="saved-trips-field saved-trips-field-full"
                          style={{ marginTop: 8, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}
                        >
                          <div>
                            <label htmlFor={`extra-suggested-sort-${section.id}`}>Sort</label>
                            <select
                              id={`extra-suggested-sort-${section.id}`}
                              value={suggestSortBy}
                              onChange={(e) => setSuggestSortBy(e.target.value as SuggestSort)}
                            >
                              <option value="name-asc">Name (A-Z)</option>
                              <option value="category-asc">Category (A-Z)</option>
                              <option value="rating-desc">Highest rating</option>
                              <option value="popularity-desc">Most popular</option>
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`extra-suggested-category-${section.id}`}>Category</label>
                            <select
                              id={`extra-suggested-category-${section.id}`}
                              value={suggestCategoryFilter}
                              onChange={(e) => setSuggestCategoryFilter(e.target.value)}
                            >
                              <option value="all">All categories</option>
                              {Array.from(
                                new Set(
                                  section.attractions.flatMap((attraction) =>
                                    (attraction.categories ?? []).map((category) => category.trim()).filter(Boolean)
                                  )
                                )
                              )
                                .sort((a, b) => a.localeCompare(b))
                                .map((category) => (
                                  <option key={category} value={category.toLowerCase()}>
                                    {category}
                                  </option>
                                ))}
                            </select>
                          </div>
                          <div>
                            <label htmlFor={`extra-suggested-price-${section.id}`}>Max cost</label>
                            <select
                              id={`extra-suggested-price-${section.id}`}
                              value={suggestMaxPriceLevel}
                              onChange={(e) => setSuggestMaxPriceLevel(e.target.value)}
                            >
                              <option value="0">All</option>
                              <option value="1">$</option>
                              <option value="2">$$</option>
                              <option value="3">$$$</option>
                              <option value="4">$$$$</option>
                            </select>
                          </div>
                        </div>
                        {section.loading ? (
                          <p className="saved-suggested-loading">Loading suggestions…</p>
                        ) : (
                          <div className="saved-suggested-grid">
                            {filterAndSortAttractions(
                              section.attractions,
                              section.searchQuery ?? "",
                              suggestSortBy,
                              suggestMaxPriceLevel,
                              suggestCategoryFilter
                            ).map(renderSuggestedCard)}
                          </div>
                        )}
                      </>
                    )}
                  </section>
                ))}
              </div>

              <section className="saved-trips-drag-schedule" aria-label="Schedule">
                <div
                  className="saved-unassigned-zone"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragSource) moveStop(dragSource, { type: "unscheduled", insertIndex: unscheduled.length });
                  }}
                >
                    <div className="saved-unassigned-header">
                      <h2 className="saved-unassigned-title">Unassigned</h2>
                      {collabVoteStats && Object.keys(collabVoteStats).length > 0 && (
                        <select
                          className="saved-unassigned-sort"
                          value={unscheduledSort}
                          onChange={(e) => setUnscheduledSort(e.target.value as "votes" | "name")}
                          aria-label="Sort unassigned attractions"
                        >
                          <option value="votes">Sort by votes</option>
                          <option value="name">Sort A–Z</option>
                        </select>
                      )}
                    </div>
                  <p className="saved-unassigned-intro">Drag places here or into a day. You can also drag directly from the attraction list.</p>
                  <div className="saved-unassigned-cards">
                    {displayedUnscheduled.map((attraction, displayIdx) => {
                      const unscheduledIdx = unscheduled.findIndex((a) => a.id === attraction.id);
                      const voteStats = collabVoteStats?.[attraction.id];
                      return (
                      <div
                        key={attraction.id}
                        className={`saved-schedule-card saved-schedule-card-clickable ${dragSource?.type === "unscheduled" && dragSource.index === unscheduledIdx ? "saved-schedule-card-dragging" : ""}`}
                        draggable
                        onClick={() => openAttractionDetails(attraction)}
                        onDragStart={() => setDragSource({ type: "unscheduled", index: unscheduledIdx })}
                        onDragEnd={() => setDragSource(null)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dragSource) moveStop(dragSource, { type: "unscheduled", insertIndex: unscheduledIdx });
                        }}
                      >
                        <span className="saved-schedule-card-handle" aria-hidden>⋮⋮</span>
                        {attraction.imageUrl ? (
                          <img src={attraction.imageUrl} alt="" className="saved-schedule-card-img" />
                        ) : (
                          <div className="saved-schedule-card-img saved-schedule-card-placeholder" aria-hidden />
                        )}
                        <div className="saved-schedule-card-body">
                          <h3>{attraction.name}</h3>
                          <p className="saved-schedule-card-meta">
                            {getAttractionMeta(attraction)}
                          </p>
                          {voteStats && (voteStats.yesVotes + voteStats.noVotes) > 0 && (
                            <div className="saved-schedule-card-vote-bar-wrap" title={`👍 ${voteStats.yesVotes} · 👎 ${voteStats.noVotes}`}>
                              <div className="saved-schedule-card-vote-bar">
                                <div
                                  className="saved-schedule-card-vote-fill-yes"
                                  style={{ width: `${(voteStats.yesVotes / (voteStats.yesVotes + voteStats.noVotes)) * 100}%` }}
                                />
                                <div
                                  className="saved-schedule-card-vote-fill-no"
                                  style={{
                                    left: `${(voteStats.yesVotes / (voteStats.yesVotes + voteStats.noVotes)) * 100}%`,
                                    width: `${(voteStats.noVotes / (voteStats.yesVotes + voteStats.noVotes)) * 100}%`
                                  }}
                                />
                              </div>
                              <span className="saved-schedule-card-vote-count">{voteStats.yesVotes}</span>
                            </div>
                          )}
                        </div>
                        <button
                          type="button"
                          className="saved-schedule-card-remove"
                          aria-label={`Remove ${attraction.name}`}
                          onMouseDown={(e) => e.stopPropagation()}
                          onClick={(e) => {
                            e.stopPropagation();
                            removeFromItinerary(attraction.id);
                          }}
                        >
                          <img
                            src="https://img.icons8.com/fluent-systems-regular/24/FA5252/trash.png"
                            alt=""
                            width={18}
                            height={18}
                            className="saved-schedule-card-remove-icon"
                          />
                        </button>
                      </div>
                    );})}
                  </div>
                </div>
                <div className="saved-calendar-shell">
                  <div className="sample-trial-panel-head">
                    <div>
                      <h3>Trip Calendar</h3>
                      <span>Drag places onto the time you want</span>
                    </div>
                    <div className="saved-calendar-header-actions">
                      <button
                        type="button"
                        className="saved-trips-button saved-trips-button-muted"
                        onClick={() => {
                          setCustomEventDialog({ mode: "create" });
                          setCustomEventDialogName("");
                          setCustomEventDialogDuration(90);
                        }}
                      >
                        Add custom event
                      </button>
                    </div>
                  </div>
                  <p className="sample-trial-panel-copy">
                    Drop a place onto a day and time. Pull the bottom tab to make the stop longer.
                  </p>
                  <div className="sample-trial-calendar">
                    <div className="sample-trial-time-rail" aria-hidden="true">
                      <div className="sample-trial-time-rail-spacer" />
                      {calendarTimeSlots.slice(0, -1).map((minute) => (
                        <div
                          key={minute}
                          className="sample-trial-time-slot"
                          style={{ height: SAMPLE_TRIAL_PX_PER_STEP }}
                        >
                          <span>{formatMinuteLabel(minute)}</span>
                        </div>
                      ))}
                    </div>
                    <div className="sample-trial-day-columns">
                      {paddedDayPlans.map((day, dayIndex) => {
                        const sortedStops = day.stops
                          .map((stop, slotIndex) => ({ stop, slotIndex }))
                          .sort(
                            (left, right) =>
                              timeToMinutes(left.stop.startTime || "09:00") -
                              timeToMinutes(right.stop.startTime || "09:00")
                          );
                        const layoutStops = sortedStops.map((entry) => {
                          const startMinute = timeToMinutes(entry.stop.startTime || "09:00");
                          const endMinute =
                            startMinute + (entry.stop.durationMinutes || SAMPLE_TRIAL_DEFAULT_DURATION);
                          return { ...entry, startMinute, endMinute };
                        });
                        const laneEndTimes: number[] = [];
                        const laneBySlot = new Map<number, number>();
                        for (const entry of layoutStops) {
                          let lane = laneEndTimes.findIndex((end) => end <= entry.startMinute);
                          if (lane < 0) {
                            lane = laneEndTimes.length;
                            laneEndTimes.push(entry.endMinute);
                          } else {
                            laneEndTimes[lane] = entry.endMinute;
                          }
                          laneBySlot.set(entry.slotIndex, lane);
                        }

                        return (
                          <section className="sample-trial-day-column" key={day.dayNumber}>
                            <header className="sample-trial-day-header">
                              <strong>Day {day.dayNumber}</strong>
                              <span>{getCalendarDateLabel(dayIndex)}</span>
                            </header>
                            <div
                              className="sample-trial-day-grid"
                              style={{ height: calendarGridHeight }}
                              onDragOver={(event) => {
                                event.preventDefault();
                                event.dataTransfer.dropEffect = "move";
                              }}
                              onDrop={(event) => {
                                event.preventDefault();
                                if (!dragSource) return;
                                const rect = event.currentTarget.getBoundingClientRect();
                                const offsetY = event.clientY - rect.top;
                                const requestedMinute =
                                  SAMPLE_TRIAL_START_MINUTE +
                                  (offsetY / SAMPLE_TRIAL_PX_PER_STEP) * SAMPLE_TRIAL_STEP_MINUTES;
                                moveStopToCalendar(dragSource, dayIndex, requestedMinute);
                              }}
                              onDoubleClick={(event) => {
                                if (dragSource) return;
                                const target = event.target;
                                if (target instanceof Element && target.closest(".sample-trial-event")) return;
                                const rect = event.currentTarget.getBoundingClientRect();
                                const offsetY = event.clientY - rect.top;
                                const requestedMinute =
                                  SAMPLE_TRIAL_START_MINUTE +
                                  (offsetY / SAMPLE_TRIAL_PX_PER_STEP) * SAMPLE_TRIAL_STEP_MINUTES;
                                setCustomEventDialog({
                                  mode: "create",
                                  dayIndex,
                                  requestedMinute
                                });
                                setCustomEventDialogName("");
                                setCustomEventDialogDuration(90);
                              }}
                            >
                              {calendarTimeSlots.slice(0, -1).map((minute) => (
                                <div
                                  key={minute}
                                  className="sample-trial-grid-line"
                                  style={{ height: SAMPLE_TRIAL_PX_PER_STEP }}
                                />
                              ))}
                              {sortedStops.length === 0 && (
                                <p className="saved-day-empty saved-day-empty-calendar">Drop places here</p>
                              )}
                              {layoutStops.map(({ stop, slotIndex, startMinute, endMinute }) => {
                                const top =
                                  ((startMinute - SAMPLE_TRIAL_START_MINUTE) /
                                    SAMPLE_TRIAL_STEP_MINUTES) *
                                  SAMPLE_TRIAL_PX_PER_STEP;
                                const height =
                                  ((stop.durationMinutes || SAMPLE_TRIAL_DEFAULT_DURATION) /
                                    SAMPLE_TRIAL_STEP_MINUTES) *
                                  SAMPLE_TRIAL_PX_PER_STEP;
                                const lane = laneBySlot.get(slotIndex) ?? 0;
                                const concurrentCount = Math.max(
                                  1,
                                  layoutStops.filter((item) =>
                                    intervalsOverlap(startMinute, endMinute, item.startMinute, item.endMinute)
                                  ).length
                                );
                                const laneWidthPct = 100 / concurrentCount;
                                const leftPct = lane * laneWidthPct;

                                return (
                                  <article
                                    key={`${day.dayNumber}-${stop.attraction.id}-${stop.startTime}-${slotIndex}`}
                                    className={`sample-trial-event saved-schedule-card-clickable ${
                                      dragSource?.type === "day" &&
                                      dragSource.dayIndex === dayIndex &&
                                      dragSource.slotIndex === slotIndex
                                        ? "sample-trial-event-dragging"
                                        : ""
                                    }`}
                                    draggable
                                    style={{
                                      top,
                                      height,
                                      left: `calc(${leftPct}% + 8px)`,
                                      width: `calc(${laneWidthPct}% - 14px)`,
                                      right: "auto"
                                    }}
                                    onClick={() => {
                                      if (isCustomEvent(stop.attraction)) {
                                        openCustomEventEditDialog(
                                          stop.attraction.id,
                                          stop.attraction.name,
                                          stop.durationMinutes || customDurationByAttractionId[stop.attraction.id] || 90
                                        );
                                        return;
                                      }
                                      openAttractionDetails(stop.attraction);
                                    }}
                                    onDragStart={() => setDragSource({ type: "day", dayIndex, slotIndex })}
                                    onDragEnd={() => setDragSource(null)}
                                  >
                                    <button
                                      type="button"
                                      className="sample-trial-event-edge sample-trial-event-edge-top"
                                      aria-label={`Resize ${stop.attraction.name} earlier`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setCalendarResizeState({
                                          dayIndex,
                                          slotIndex,
                                          startY: event.clientY,
                                          initialStartMinute: timeToMinutes(stop.startTime || "09:00"),
                                          initialDuration: stop.durationMinutes || SAMPLE_TRIAL_DEFAULT_DURATION,
                                          edge: "top"
                                        });
                                      }}
                                    />
                                    <div className="sample-trial-event-copy">
                                      <strong>
                                        {stop.attraction.name} •{" "}
                                        <span>
                                          {formatCalendarTimeRange(
                                            stop.startTime,
                                            stop.durationMinutes
                                          )}
                                        </span>
                                      </strong>
                                    </div>
                                    <div className="sample-trial-event-actions">
                                      {isCustomEvent(stop.attraction) && (
                                        <button
                                          type="button"
                                          className="sample-trial-event-edit"
                                          aria-label={`Edit ${stop.attraction.name}`}
                                          onMouseDown={(e) => e.stopPropagation()}
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            openCustomEventEditDialog(
                                              stop.attraction.id,
                                              stop.attraction.name,
                                              stop.durationMinutes || customDurationByAttractionId[stop.attraction.id] || 90
                                            );
                                          }}
                                        >
                                          ✎
                                        </button>
                                      )}
                                      <button
                                        type="button"
                                        className="sample-trial-event-remove"
                                        aria-label={`Remove ${stop.attraction.name}`}
                                        onMouseDown={(e) => e.stopPropagation()}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          removeFromItinerary(stop.attraction.id);
                                        }}
                                      >
                                        ×
                                      </button>
                                    </div>
                                    <button
                                      type="button"
                                      className="sample-trial-event-edge sample-trial-event-edge-bottom"
                                      aria-label={`Resize ${stop.attraction.name} later`}
                                      onMouseDown={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        setCalendarResizeState({
                                          dayIndex,
                                          slotIndex,
                                          startY: event.clientY,
                                          initialStartMinute: timeToMinutes(stop.startTime || "09:00"),
                                          initialDuration: stop.durationMinutes || SAMPLE_TRIAL_DEFAULT_DURATION,
                                          edge: "bottom"
                                        });
                                      }}
                                    />
                                  </article>
                                );
                              })}
                            </div>
                          </section>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </section>
          </section>

          <section className="saved-trips-share">
            <div
              className="saved-trips-actions"
              style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}
            >
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? "Saving..." : activeItineraryId ? "Save Changes" : "Save & Get Shareable Link"}
              </button>
            </div>
            {saveError && (
              <p className="attractions-state attractions-state-error" style={{ marginTop: 8 }}>
                {saveError}
              </p>
            )}
          </section>
      {customEventDialog && (
        <div className="custom-event-dialog-overlay" role="dialog" aria-modal="true" aria-label="Custom event">
          <button
            type="button"
            className="custom-event-dialog-backdrop"
            onClick={closeCustomEventDialog}
            aria-label="Close custom event dialog"
          />
          <section className="custom-event-dialog-content">
            <div className="custom-event-dialog-head">
              <div>
                <h2>{customEventDialog.mode === "edit" ? "Edit custom event" : "Add custom event"}</h2>
                <p>
                  {customEventDialog.mode === "edit"
                    ? "Update the event name and duration."
                    : "Name your custom event and add it to this time slot."}
                </p>
              </div>
              <button
                type="button"
                className="custom-event-dialog-close"
                onClick={closeCustomEventDialog}
                aria-label="Close custom event dialog"
              >
                ×
              </button>
            </div>
            <div className="custom-event-dialog-fields">
              <label className="custom-event-dialog-field">
                <span>Event name</span>
                <input
                  type="text"
                  value={customEventDialogName}
                  onChange={(event) => setCustomEventDialogName(event.target.value)}
                  placeholder="Dinner reservation, flight, check-in..."
                  autoFocus
                />
              </label>
              <label className="custom-event-dialog-field">
                <span>Duration</span>
                <select
                  value={customEventDialogDuration}
                  onChange={(event) => setCustomEventDialogDuration(Number(event.target.value) || 90)}
                >
                  {[30, 45, 60, 90, 120, 180, 240].map((mins) => (
                    <option key={mins} value={mins}>
                      {mins < 60 ? `${mins}m` : mins === 60 ? "1h" : `${mins / 60}h`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="custom-event-dialog-actions">
              <button
                type="button"
                className="saved-trips-button saved-trips-button-muted"
                onClick={closeCustomEventDialog}
              >
                Cancel
              </button>
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                onClick={handleSaveCustomEventDialog}
                disabled={!customEventDialogName.trim()}
              >
                {customEventDialog.mode === "edit" ? "Save changes" : "Add event"}
              </button>
            </div>
          </section>
        </div>
      )}
      <AttractionDetailsModal
        attraction={selectedAttraction}
        isFavorited={selectedAttraction ? isFavorite(selectedAttraction.id) : false}
        isInItinerary={selectedAttraction ? isInItinerary(selectedAttraction.id) : false}
        onToggleFavorite={(attraction) => {
          if (isFavorite(attraction.id)) {
            removeFavorite(attraction.id);
            addUndo(`Removed ${attraction.name} from favorites`, () => addFavorite(attraction));
            return;
          }
          addFavorite(attraction);
        }}
        onToggleItinerary={(attraction) => {
          if (isInItinerary(attraction.id)) {
            removeFromItinerary(attraction.id);
            return;
          }
          addAttraction(attraction);
        }}
        onClose={() => setSelectedAttraction(null)}
      />
    </div>
  );

  if (embedded) {
    return <>{body}</>;
  }

  return <AppShell activeTab="itinerary">{body}</AppShell>;
});

export default SavedTripBuilderComponent;
