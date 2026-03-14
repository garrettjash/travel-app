import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FavoriteAttraction } from "./favorites-context";

export type ItineraryAttraction = FavoriteAttraction;

type ItineraryContextValue = {
  attractions: ItineraryAttraction[];
  addAttraction: (attraction: ItineraryAttraction) => void;
  removeAttraction: (attractionId: number) => void;
  reorderAttractions: (fromIndex: number, toIndex: number) => void;
  clearAttractions: () => void;
  isInItinerary: (attractionId: number) => boolean;
};

const ItineraryContext = createContext<ItineraryContextValue | undefined>(undefined);

export function ItineraryProvider({ children }: { children: ReactNode }) {
  // Session-only: no persistence. Avoids buildup when starting new itineraries.
  const [attractions, setAttractions] = useState<ItineraryAttraction[]>([]);

  const addAttraction = useCallback((attraction: ItineraryAttraction) => {
    setAttractions((current) => {
      if (current.some((item) => item.id === attraction.id)) return current;
      return [...current, attraction];
    });
  }, []);

  const removeAttraction = useCallback((attractionId: number) => {
    setAttractions((current) => current.filter((item) => item.id !== attractionId));
  }, []);

  const reorderAttractions = useCallback((fromIndex: number, toIndex: number) => {
    setAttractions((current) => {
      if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= current.length || toIndex >= current.length) {
        return current;
      }
      const next = [...current];
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
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
      reorderAttractions,
      clearAttractions,
      isInItinerary
    }),
    [attractions, addAttraction, removeAttraction, reorderAttractions, clearAttractions, isInItinerary]
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

