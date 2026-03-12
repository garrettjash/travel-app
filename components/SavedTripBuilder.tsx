import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "./AppShell";
import AttractionDetailsModal from "./AttractionDetailsModal";
import { useAuth } from "../lib/auth-context";
import { FavoriteAttraction, useFavorites } from "../lib/favorites-context";
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

const slotOrder: Slot[] = ["Morning", "Afternoon", "Evening"];

const BUILD_CATEGORIES = [
  "Landmark",
  "Restaurant",
  "Food",
  "Activity",
  "Shopping",
  "Nature",
  "Museum",
  "Show",
  "Nightlife",
  "Outdoor",
  "Attraction",
  "Entertainment"
];

/** Map user-facing type (e.g. Food) to category values we match in attraction.categories. Enables future AI-driven mapping. */
const BUILD_TYPE_ALIASES: Record<string, string[]> = {
  Food: ["Restaurant", "Food", "Dining", "Cafe", "Bar"]
};

type DragSource =
  | { type: "day"; dayIndex: number; slotIndex: number }
  | { type: "unscheduled"; index: number };

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

function formatCategoryLabel(categories: string[] | undefined): string {
  if (!categories?.length) return "";
  return categories.slice(0, 2).join(" • ").trim();
}

function getSlotLabel(stopIndex: number, totalInDay: number): string {
  if (totalInDay > 3) return `Stop ${stopIndex + 1}`;
  return slotOrder[stopIndex] ?? "Morning";
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

const SUGGESTED_LIMIT = 24;

export default function SavedTripBuilder({
  initialItinerary,
  itineraryIdFromRoute,
  embedded,
  initialTripPlace
}: SavedTripBuilderProps) {
  const router = useRouter();
  const { user } = useAuth();
  const { toggleFavorite, isFavorite } = useFavorites();
  const { attractions, addAttraction, removeAttraction, clearAttractions, isInItinerary } = useItinerary();

  const [selectedAttraction, setSelectedAttraction] = useState<FavoriteAttraction | null>(null);

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
  const [tripPlace, setTripPlace] = useState(initialItinerary?.tripPlace ?? initialTripPlace ?? "");
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
  const [isShareCodeCopied, setIsShareCodeCopied] = useState(false);
  const [dragSource, setDragSource] = useState<DragSource | null>(null);
  const [buildForMeOpen, setBuildForMeOpen] = useState(false);
  const [buildTypes, setBuildTypes] = useState<Set<string>>(new Set());
  const [buildShuffle, setBuildShuffle] = useState(false);
  const [shareCode, setShareCode] = useState<string | null>(initialItinerary?.shareCode ?? null);

  const tripDays = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);

  /** Padded day plans so we always have tripDays entries for drop zones */
  const paddedDayPlans = useMemo(() => {
    const next = [...dayPlans];
    while (next.length < tripDays) {
      next.push({ dayNumber: next.length + 1, stops: [] });
    }
    return next.slice(0, tripDays);
  }, [dayPlans, tripDays]);

  /** Type options for Build for me: categories that actually appear in unassigned, so the list is always relevant */
  const buildTypeOptions = useMemo(() => {
    const seen = new Set<string>();
    for (const a of unscheduled) {
      for (const c of a.categories ?? []) {
        const t = c.trim();
        if (t) seen.add(t);
      }
    }
    const list = Array.from(seen).sort((a, b) => a.localeCompare(b));
    return list.length > 0 ? list : BUILD_CATEGORIES;
  }, [unscheduled]);

  const totalStops = dayPlans.reduce((sum, day) => sum + day.stops.length, 0);
  const activeTripName = tripName.trim() || "Untitled Trip";

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

  /** Effective trip location: from dropdown selection, input, or saved/prop value */
  const effectiveLocation = useMemo(
    () =>
      (selectedPlace?.label ?? placeInputValue.trim() ?? tripPlace.trim() ?? initialTripPlace ?? "").trim(),
    [selectedPlace?.label, placeInputValue, tripPlace, initialTripPlace]
  );

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

  useEffect(() => {
    if (!initialItinerary || !initialItinerary.itineraryId) return;
    const id = sanitizeItineraryId(initialItinerary.itineraryId);
    if (!id) return;
    const url = `${window.location.origin}/saved-trips/${encodeURIComponent(id)}`;
    setShareLink(url);
    setActiveItineraryId(id);
  }, [initialItinerary]);

  useEffect(() => {
    if (!initialItinerary) return;
    const all: FavoriteAttraction[] = [];
    for (const day of initialItinerary.days ?? []) {
      for (const stop of day.stops) all.push(stop.attraction);
    }
    for (const a of initialItinerary.unscheduled ?? []) all.push(a);
    all.forEach((a) => addAttraction(a));
  }, [initialItinerary?.itineraryId]);

  // Sync unscheduled so items added from Destinations (or elsewhere) appear in Unassigned (deduplicated by id)
  useEffect(() => {
    const inDayIds = new Set(dayPlans.flatMap((d) => d.stops.map((s) => s.attraction.id)));
    const unassigned = attractions.filter((a) => !inDayIds.has(a.id));
    setUnscheduled((current) => {
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

  // Clear drag state when any drag ends (e.g. drop outside or cancel) so cards don't stay greyed
  useEffect(() => {
    const clearDrag = () => setDragSource(null);
    document.addEventListener("dragend", clearDrag);
    return () => document.removeEventListener("dragend", clearDrag);
  }, []);

  type DropTarget =
    | { type: "day"; dayIndex: number; insertIndex: number }
    | { type: "unscheduled"; insertIndex: number };

  const moveStop = useCallback(
    (from: DragSource, to: DropTarget) => {
      let attraction: FavoriteAttraction;
      let slot: Slot = "Morning";

      if (from.type === "day") {
        const stop = dayPlans[from.dayIndex]?.stops[from.slotIndex];
        if (!stop) return;
        attraction = stop.attraction;
        slot = stop.slot;
      } else {
        const item = unscheduled[from.index];
        if (!item) return;
        attraction = item;
        if (to.type === "day") slot = slotOrder[to.insertIndex % slotOrder.length] ?? "Morning";
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
            const newStop: PlannedStop = { attraction, slot };
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
        if (to.type === "unscheduled") {
          const next = [...current];
          next.splice(to.insertIndex, 0, attraction);
          return next;
        }
        return current;
      });
      setDragSource(null);
    },
    [dayPlans, unscheduled, tripDays]
  );

  const clearPlan = () => {
    if (typeof window !== "undefined") {
      const confirmed = window.confirm("Clear schedule and remove all places from this itinerary?");
      if (!confirmed) return;
    }
    clearAttractions();
    setDayPlans([]);
    setUnscheduled([]);
    setNotes("");
  };

  /** Remove an attraction from the entire itinerary (context, unscheduled, all days). Use for every remove action. */
  const removeFromItinerary = useCallback((attractionId: number) => {
    removeAttraction(attractionId);
    setUnscheduled((c) => c.filter((x) => x.id !== attractionId));
    setDayPlans((c) => c.map((d) => ({ ...d, stops: d.stops.filter((s) => s.attraction.id !== attractionId) })));
  }, [removeAttraction]);

  /** Build itinerary from unassigned items matching selected types (and pace). Structured for future AI hook. */
  const handleBuildForMeApply = useCallback(() => {
    const stopsPerDay = pace === "relaxed" ? 1 : pace === "packed" ? 3 : 2;
    const capacity = tripDays * stopsPerDay;
    let pool = unscheduled.filter((a) => {
      if (buildTypes.size === 0) return true;
      const cats = (a.categories ?? []).map((c) => c.toLowerCase());
      return [...buildTypes].some((t) => {
        const aliases = BUILD_TYPE_ALIASES[t] ?? [t];
        return aliases.some((alias) => cats.includes(alias.toLowerCase()));
      });
    });
    if (buildShuffle) {
      const next = [...pool];
      for (let i = next.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [next[i], next[j]] = [next[j], next[i]];
      }
      pool = next;
    }
    const picked = pool.slice(0, capacity);
    const remaining = pool.slice(capacity);
    const notInPool = unscheduled.filter((a) => !pool.some((p) => p.id === a.id));
    const newUnscheduled = [...remaining, ...notInPool];

    const days: DayPlan[] = [];
    for (let d = 0; d < tripDays; d++) {
      days.push({ dayNumber: d + 1, stops: [] });
    }
    picked.forEach((attraction, index) => {
      const dayIndex = Math.floor(index / stopsPerDay);
      const slotIndex = index % stopsPerDay;
      const slot = slotOrder[slotIndex] ?? "Morning";
      if (days[dayIndex]) days[dayIndex].stops.push({ attraction, slot });
    });

    setDayPlans(days);
    setUnscheduled(newUnscheduled);
    setBuildForMeOpen(false);
  }, [pace, tripDays, unscheduled, buildTypes, buildShuffle]);

  async function handleSave(event?: FormEvent) {
    if (event) event.preventDefault();

    setIsSaving(true);
    setSaveError(null);
    setIsShareCopied(false);
    setIsShareCodeCopied(false);

    const payload: any = {
      itineraryId: activeItineraryId || undefined,
      userId: user?.id ?? undefined,
      tripName: activeTripName,
      tripPlace: tripPlace.trim(),
      placeId: selectedPlace?.id ?? undefined,
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

      if (data.shareCode) {
        setShareCode(data.shareCode);
      }

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

  async function handleExport() {
    if (!startDate || dayPlans.length === 0) return;

    const events: string[] = [];
    const baseTitle = activeTripName || "Trip";
    const cleanedTitle = baseTitle.replace(/\r?\n/g, " ").trim();

    for (const day of dayPlans) {
      if (!day.stops.length) continue;
      const dayIndex = day.dayNumber - 1;
      const baseDate = new Date(startDate);
      if (Number.isNaN(baseDate.getTime())) continue;
      const eventDate = new Date(baseDate.getTime() + dayIndex * 24 * 60 * 60 * 1000);
      const datePart = formatDateForIcs(eventDate);

      const stops = day.stops;
      const total = stops.length;

      for (let i = 0; i < total; i++) {
        const stop = stops[i];
        const a = stop.attraction;

        let startHour = 10;
        let startMinute = 0;

        if (total <= 3) {
          // Use Morning / Afternoon / Evening mapping
          const slotLabel = stop.slot;
          if (slotLabel === "Morning") startHour = 10;
          else if (slotLabel === "Afternoon") startHour = 14;
          else if (slotLabel === "Evening") startHour = 17;
        } else {
          // Evenly space between 9:00 and 20:00
          const firstMinutes = 9 * 60;
          const lastMinutes = 20 * 60;
          const span = lastMinutes - firstMinutes;
          const step = total > 1 ? Math.floor(span / (total - 1)) : span;
          const minutesFromStart = firstMinutes + step * i;
          startHour = Math.floor(minutesFromStart / 60);
          startMinute = minutesFromStart % 60;
        }

        const startTime = formatTimeForIcs(startHour, startMinute);
        // default to 1 hour duration
        let endHour = startHour;
        let endMinute = startMinute + 60;
        if (endMinute >= 60) {
          endHour += Math.floor(endMinute / 60);
          endMinute = endMinute % 60;
        }
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

  const body = (
    <>
          <section
            className="saved-trips-header"
            style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}
          >
            <div>
              <h1>Itinerary</h1>
              <p>Turn your favorites into a ready-to-go itinerary in one click and save it with a shareable link.</p>
            </div>
            <button
              type="button"
              className="saved-trips-button"
              onClick={handleExport}
              style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
            >
              <img
                src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAJQAAACUCAMAAABC4vDmAAAAXVBMVEX///8AAACbm5tQUFDv7+94eHi1tbV9fX1ERETQ0NCpqank5OQzMzMqKirJycnExMQXFxcICAj4+PglJSUeHh5hYWE5OTnb29u7u7sRERGRkZFKSkpVVVVsbGyKioovde/pAAACaElEQVR4nO3ca5OCIBQG4INprZey0i7W7v7/n7maylHCQkehmX3fLzXVwDNABF4imifxLct+45kKmyn+WZQ5+64d3YRb8UhycS3hxIloknxMD7btVGUbutbUuXRMpeojejDMRS/ZB7RVuBVK3Pfgbq+ahNjvHJuyZ1PZg05VqY5UJXVoyodQuTMVt9O+mT0THmGOVNdCCsJN/bgJ5UvF1YmJ608pqJ8FlLLUgWotKz+U85JEUXiQb6xtmzrtVH3/GUU7Z20V8Rh/zN8dFIU82iObpn7fKShHPejJSvNmTdBD0YXnL8+WiftOtL+9fRTxzGCrrW6ywq1cZyooinntcLNh4nY68HpORdGFx5WF0c5jvLsef0J11u0WZoZTW1XR3SM8oyiW89VpcVRbVX+Pp0E1e8GKvziqaamsv+/UocjPbLVU/W2/K3thLYr8e2/eWFJVduBJ3Z/rUeSf7JjKHJ9fGkDpP2wrwyiHAco0QJkGKNMAZRqgTAOUaSygYm/zJoFy+EmPSoN35XjGJwOugwfoOMq+SY+KXpdRJTfc6vjvi5oPJYTZSSajouZDme1VvfcFzYkyOwQC1EhU8fUiiXKER49aJ6/KKCagvsdsjiZMnsfvCajVmBPCE1D+CiiggAIKKKCAAgoooIACCiiggAIKKKCAAgoooOZHtZd+fxSqub55zHWKy6Pq/ht1ttYCiq5BMO56Thuo0QEKKKCAAgoooIACCiiggAIKKKCAAgoooIACCiiggHKEGnWLyoRMukXlvF445wkoWwHqH6AG/2dumRj+I9uPTdOPmYmOkcHttfMkj3Sz4R8cySgb1UR8OgAAAABJRU5ErkJggg=="
                alt=""
                width={18}
                height={18}
              />
              <span>Export</span>
            </button>
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
            <div className="saved-trips-actions">
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                onClick={() => setBuildForMeOpen((o) => !o)}
                aria-expanded={buildForMeOpen}
              >
                Build for me
              </button>
              <button type="button" className="saved-trips-button saved-trips-button-muted" onClick={clearPlan}>
                Clear schedule
              </button>
            </div>

            {buildForMeOpen && (
              <section className="saved-build-for-me-panel" aria-label="Build for me options">
                <h3 className="saved-build-for-me-title">Auto-fill your days</h3>
                <p className="saved-build-for-me-intro">
                  Apply will automatically put your unassigned places into the days above. Choose pace (stops per day). Optionally filter by type—only checked types are used; if none are checked, all unassigned places are used.
                </p>
                <div className="saved-build-for-me-row">
                  <label className="saved-build-for-me-label">Pace</label>
                  <select
                    value={pace}
                    onChange={(e) => setPace(e.target.value as Pace)}
                    className="saved-build-for-me-select"
                  >
                    <option value="relaxed">Relaxed (1 stop/day)</option>
                    <option value="balanced">Balanced (2 stops/day)</option>
                    <option value="packed">Packed (3 stops/day)</option>
                  </select>
                </div>
                <div className="saved-build-for-me-row">
                  <span className="saved-build-for-me-label">Types (from your unassigned list)</span>
                  <div className="saved-build-for-me-types">
                    {buildTypeOptions.map((cat) => (
                      <label key={cat} className="saved-build-for-me-check">
                        <input
                          type="checkbox"
                          checked={buildTypes.has(cat)}
                          onChange={(e) => {
                            setBuildTypes((prev) => {
                              const next = new Set(prev);
                              if (e.target.checked) next.add(cat);
                              else next.delete(cat);
                              return next;
                            });
                          }}
                        />
                        <span>{cat}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div className="saved-build-for-me-row">
                  <label className="saved-build-for-me-check saved-build-for-me-shuffle">
                    <input
                      type="checkbox"
                      checked={buildShuffle}
                      onChange={(e) => setBuildShuffle(e.target.checked)}
                    />
                    <span>Shuffle order before assigning</span>
                  </label>
                </div>
                <div className="saved-build-for-me-actions">
                  <button
                    type="button"
                    className="saved-trips-button saved-trips-button-primary"
                    onClick={handleBuildForMeApply}
                  >
                    Apply
                  </button>
                  <button type="button" className="saved-trips-button saved-trips-button-muted" onClick={() => setBuildForMeOpen(false)}>
                    Cancel
                  </button>
                </div>
              </section>
            )}
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

          {!router.query.fromCollab && effectiveLocation && (
            <section className="saved-suggested-section" aria-labelledby="suggested-heading">
              <h2 id="suggested-heading">Suggested in {effectiveLocation}</h2>
              <p className="saved-suggested-intro">Click + to add a place to your itinerary.</p>
              {loadingSuggested ? (
                <p className="saved-suggested-loading">Loading suggestions…</p>
              ) : (
                <div className="saved-suggested-grid">
                  {suggestedAttractions.map((attraction) => {
                    const added = isInItinerary(attraction.id);
                    return (
                      <article
                        className="saved-suggested-card saved-suggested-card-clickable"
                        key={attraction.id}
                        onClick={() => setSelectedAttraction(attraction)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            setSelectedAttraction(attraction);
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
                          <p className="saved-suggested-card-meta">
                            {formatLocation(attraction.city, attraction.stateProvince, attraction.country)}
                            {formatCategoryLabel(attraction.categories) && (
                              <span className="saved-suggested-card-type"> · {formatCategoryLabel(attraction.categories)}</span>
                            )}
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
                            aria-label={added ? `Remove ${attraction.name} from itinerary` : `Add ${attraction.name} to itinerary`}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (added) {
                                removeFromItinerary(attraction.id);
                              } else {
                                addAttraction(attraction);
                                setUnscheduled((u) => [...u, attraction]);
                              }
                            }}
                          >
                            {added ? "✓ Added (click to remove)" : "+ Add"}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {(unscheduled.length === 0 && !dayPlans.some((d) => d.stops.length > 0)) ? (
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
                  <h2 className="saved-unassigned-title">Unassigned</h2>
                  <p className="saved-unassigned-intro">Drag places here or into a day. Drag between days to reorder.</p>
                  <div className="saved-unassigned-cards">
                    {unscheduled.map((attraction, idx) => (
                      <div
                        key={attraction.id}
                        className={`saved-schedule-card saved-schedule-card-clickable ${dragSource?.type === "unscheduled" && dragSource.index === idx ? "saved-schedule-card-dragging" : ""}`}
                        draggable
                        onClick={() => setSelectedAttraction(attraction)}
                        onDragStart={() => setDragSource({ type: "unscheduled", index: idx })}
                        onDragEnd={() => setDragSource(null)}
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          if (dragSource) moveStop(dragSource, { type: "unscheduled", insertIndex: idx });
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
                            {formatLocation(attraction.city, attraction.stateProvince, attraction.country)}
                            {formatCategoryLabel(attraction.categories) && (
                              <span className="saved-schedule-card-type"> · {formatCategoryLabel(attraction.categories)}</span>
                            )}
                          </p>
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
                    ))}
                  </div>
                </div>

                <div className="saved-days-drag">
                  {paddedDayPlans.map((day, dayIndex) => (
                    <article className="saved-day-card saved-day-droppable" key={day.dayNumber}>
                      <header>
                        <h2>Day {day.dayNumber}</h2>
                      </header>
                      <div
                        className="saved-day-stops"
                        onDragOver={(e) => {
                          e.preventDefault();
                          e.dataTransfer.dropEffect = "move";
                        }}
                        onDrop={(e) => {
                          e.preventDefault();
                          if (dragSource) moveStop(dragSource, { type: "day", dayIndex, insertIndex: day.stops.length });
                        }}
                      >
                        {day.stops.map((stop, slotIndex) => (
                          <div
                            key={`${day.dayNumber}-${stop.attraction.id}-${stop.slot}`}
                            className={`saved-schedule-card saved-schedule-card-in-day saved-schedule-card-clickable ${dragSource?.type === "day" && dragSource.dayIndex === dayIndex && dragSource.slotIndex === slotIndex ? "saved-schedule-card-dragging" : ""}`}
                            draggable
                            onClick={() => setSelectedAttraction(stop.attraction)}
                            onDragStart={() => setDragSource({ type: "day", dayIndex, slotIndex })}
                            onDragEnd={() => setDragSource(null)}
                            onDragOver={(e) => {
                              e.preventDefault();
                              e.dataTransfer.dropEffect = "move";
                            }}
                            onDrop={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              if (dragSource) moveStop(dragSource, { type: "day", dayIndex, insertIndex: slotIndex });
                            }}
                          >
                            <span className="saved-stop-slot">{getSlotLabel(slotIndex, day.stops.length)}</span>
                            {stop.attraction.imageUrl ? (
                              <img src={stop.attraction.imageUrl} alt="" className="saved-schedule-card-img" />
                            ) : (
                              <div className="saved-schedule-card-img saved-schedule-card-placeholder" aria-hidden />
                            )}
                            <div className="saved-schedule-card-body">
                              <h3>{stop.attraction.name}</h3>
                              <p className="saved-schedule-card-meta">
                                {formatLocation(stop.attraction.city, stop.attraction.stateProvince, stop.attraction.country)}
                                {formatCategoryLabel(stop.attraction.categories) && (
                                  <span className="saved-schedule-card-type"> · {formatCategoryLabel(stop.attraction.categories)}</span>
                                )}
                              </p>
                            </div>
                            <button
                              type="button"
                              className="saved-schedule-card-remove"
                              aria-label={`Remove ${stop.attraction.name}`}
                              onMouseDown={(e) => e.stopPropagation()}
                              onClick={(e) => {
                                e.stopPropagation();
                                removeFromItinerary(stop.attraction.id);
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
                        ))}
                        {day.stops.length === 0 && (
                          <p className="saved-day-empty">Drop places here</p>
                        )}
                      </div>
                    </article>
                  ))}
                </div>
              </section>
          )}

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
              {shareLink && (
                <button
                  type="button"
                  className="saved-trips-button"
                  onClick={handleCopyShareLink}
                >
                  {isShareCopied ? "Link Copied!" : "Copy Share Link"}
                </button>
              )}
              {user?.id && shareCode && (
                <>
                  <span>
                    Share Code: <strong>{shareCode}</strong>
                  </span>
                  <button
                    type="button"
                    className="saved-trips-button"
                    onClick={handleCopyShareCode}
                  >
                    {isShareCodeCopied ? "Code Copied!" : "Copy Code"}
                  </button>
                </>
              )}
            </div>
            {saveError && (
              <p className="attractions-state attractions-state-error" style={{ marginTop: 8 }}>
                {saveError}
              </p>
            )}
          </section>
      <AttractionDetailsModal
        attraction={selectedAttraction}
        isFavorited={selectedAttraction ? isFavorite(selectedAttraction.id) : false}
        onToggleFavorite={toggleFavorite}
        onClose={() => setSelectedAttraction(null)}
      />
    </>
  );

  if (embedded) {
    return <>{body}</>;
  }

  return <AppShell activeTab="itinerary">{body}</AppShell>;
}
