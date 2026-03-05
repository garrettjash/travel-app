import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FavoriteAttraction } from "./favorites-context";

export type ItineraryAttraction = FavoriteAttraction;

type ItineraryContextValue = {
  attractions: ItineraryAttraction[];
  addAttraction: (attraction: ItineraryAttraction) => void;
  removeAttraction: (attractionId: number) => void;
  clearAttractions: () => void;
  isInItinerary: (attractionId: number) => boolean;
};

const ItineraryContext = createContext<ItineraryContextValue | undefined>(undefined);

const STORAGE_KEY = "travel-app-itinerary-attractions";

export function ItineraryProvider({ children }: { children: ReactNode }) {
  const [attractions, setAttractions] = useState<ItineraryAttraction[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return;
      setAttractions(parsed as ItineraryAttraction[]);
    } catch {
      setAttractions([]);
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(attractions));
    } catch {
      // ignore storage errors
    }
  }, [attractions]);

  const addAttraction = useCallback((attraction: ItineraryAttraction) => {
    setAttractions((current) => {
      if (current.some((item) => item.id === attraction.id)) return current;
      return [...current, attraction];
    });
  }, []);

  const removeAttraction = useCallback((attractionId: number) => {
    setAttractions((current) => current.filter((item) => item.id !== attractionId));
  }, []);

  const clearAttractions = useCallback(() => {
    setAttractions([]);
  }, []);

  const isInItinerary = useCallback(
    (attractionId: number) => attractions.some((item) => item.id === attractionId),
    [attractions]
  );

  const value = useMemo(
    () => ({
      attractions,
      addAttraction,
      removeAttraction,
      clearAttractions,
      isInItinerary
    }),
    [attractions, addAttraction, removeAttraction, clearAttractions, isInItinerary]
  );

  return <ItineraryContext.Provider value={value}>{children}</ItineraryContext.Provider>;
}

export function useItinerary() {
  const context = useContext(ItineraryContext);
  if (!context) {
    throw new Error("useItinerary must be used within an ItineraryProvider.");
  }
  return context;
}

