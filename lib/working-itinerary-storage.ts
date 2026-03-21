import type { FavoriteAttraction } from "./favorites-context";

export type PersistedDayPlan = {
  dayNumber: number;
  stops: { attraction: FavoriteAttraction; startTime: string; durationMinutes: number }[];
};

export type PersistedWorkingItinerary = {
  itineraryId: string;
  tripName: string;
  tripPlace: string;
  startDate: string;
  endDate: string;
  pace: "relaxed" | "balanced" | "packed";
  notes: string;
  days: PersistedDayPlan[];
  unscheduled: FavoriteAttraction[];
};

const CURRENT_ITINERARY_KEY = "travel-app-current-itinerary-id";
const WORKING_PREFIX = "travel-app-working-itinerary-";

function storageKey(itineraryId: string): string {
  return `${WORKING_PREFIX}${itineraryId}`;
}

export function setCurrentItineraryId(itineraryId: string | null): void {
  try {
    if (typeof window === "undefined") return;
    if (itineraryId) {
      window.localStorage.setItem(CURRENT_ITINERARY_KEY, itineraryId);
    } else {
      window.localStorage.removeItem(CURRENT_ITINERARY_KEY);
    }
  } catch {
    /* ignore */
  }
}

export function getCurrentItineraryId(): string | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage.getItem(CURRENT_ITINERARY_KEY);
  } catch {
    return null;
  }
}

export function hasWorkingItinerary(): boolean {
  const id = getCurrentItineraryId();
  if (!id) return false;
  const data = loadWorkingItinerary(id);
  return data !== null;
}

export function isInWorkingItinerary(attractionId: number): boolean {
  const id = getCurrentItineraryId();
  if (!id) return false;
  const data = loadWorkingItinerary(id);
  if (!data) return false;
  const ids = new Set<number>([
    ...data.unscheduled.map((a) => a.id),
    ...data.days.flatMap((d) => (d.stops ?? []).map((s) => s.attraction.id))
  ]);
  return ids.has(attractionId);
}

export function loadWorkingItinerary(itineraryId: string): PersistedWorkingItinerary | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = window.localStorage.getItem(storageKey(itineraryId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const p = parsed as Record<string, unknown>;
    if (
      typeof p.itineraryId !== "string" ||
      !Array.isArray(p.days) ||
      !Array.isArray(p.unscheduled)
    ) {
      return null;
    }
    return parsed as PersistedWorkingItinerary;
  } catch {
    return null;
  }
}

export function saveWorkingItinerary(data: PersistedWorkingItinerary): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(storageKey(data.itineraryId), JSON.stringify(data));
  } catch {
    /* ignore */
  }
}

export function addAttractionToWorkingItinerary(
  itineraryId: string,
  attraction: FavoriteAttraction
): boolean {
  const existing = loadWorkingItinerary(itineraryId);
  if (!existing) {
    const created: PersistedWorkingItinerary = {
      itineraryId,
      tripName: "",
      tripPlace: "",
      startDate: new Date().toISOString().slice(0, 10),
      endDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
      pace: "balanced",
      notes: "",
      days: [],
      unscheduled: [attraction]
    };
    saveWorkingItinerary(created);
    return true;
  }
  const existingIds = new Set([
    ...existing.unscheduled.map((a) => a.id),
    ...existing.days.flatMap((d) => d.stops.map((s) => s.attraction.id))
  ]);
  if (existingIds.has(attraction.id)) return false;
  saveWorkingItinerary({
    ...existing,
    unscheduled: [...existing.unscheduled, attraction]
  });
  return true;
}

export function removeAttractionFromWorkingItinerary(
  itineraryId: string,
  attractionId: number
): boolean {
  const existing = loadWorkingItinerary(itineraryId);
  if (!existing) return false;
  const newUnscheduled = existing.unscheduled.filter((a) => a.id !== attractionId);
  const newDays = existing.days.map((d) => ({
    ...d,
    stops: (d.stops ?? []).filter((s) => s.attraction.id !== attractionId)
  }));
  if (
    newUnscheduled.length === existing.unscheduled.length &&
    newDays.every((d, i) => (d.stops?.length ?? 0) === (existing.days[i]?.stops?.length ?? 0))
  ) {
    return false;
  }
  saveWorkingItinerary({ ...existing, unscheduled: newUnscheduled, days: newDays });
  return true;
}

export function clearWorkingItinerary(itineraryId: string): void {
  try {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(storageKey(itineraryId));
  } catch {
    /* ignore */
  }
}

/** Clear working itineraries on full page reload so draft is not restored. */
export function clearWorkingItinerariesOnReload(): void {
  try {
    if (typeof window === "undefined") return;
    const nav = performance.getEntriesByType?.("navigation")?.[0] as
      | { type?: string }
      | undefined;
    if (nav?.type === "reload") {
      const id = getCurrentItineraryId();
      if (id) clearWorkingItinerary(id);
    }
  } catch {
    /* ignore */
  }
}
