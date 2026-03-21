import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from "react";

export type FavoriteAttraction = {
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

type FavoritesContextValue = {
  favorites: FavoriteAttraction[];
  toggleFavorite: (attraction: FavoriteAttraction) => void;
  addFavorite: (attraction: FavoriteAttraction) => void;
  removeFavorite: (attractionId: number) => void;
  isFavorite: (attractionId: number) => boolean;
};

const FavoritesContext = createContext<FavoritesContextValue | undefined>(undefined);

export function FavoritesProvider({ children }: { children: ReactNode }) {
  const [favorites, setFavorites] = useState<FavoriteAttraction[]>([]);

  const toggleFavorite = useCallback((attraction: FavoriteAttraction) => {
    setFavorites((current) => {
      const exists = current.some((item) => item.id === attraction.id);
      if (exists) return current.filter((item) => item.id !== attraction.id);
      return [attraction, ...current];
    });
  }, []);

  const addFavorite = useCallback((attraction: FavoriteAttraction) => {
    setFavorites((current) =>
      current.some((item) => item.id === attraction.id) ? current : [attraction, ...current]
    );
  }, []);

  const removeFavorite = useCallback((attractionId: number) => {
    setFavorites((current) => current.filter((item) => item.id !== attractionId));
  }, []);

  const isFavorite = useCallback(
    (attractionId: number) => favorites.some((item) => item.id === attractionId),
    [favorites]
  );

  const value = useMemo(
    () => ({ favorites, toggleFavorite, addFavorite, removeFavorite, isFavorite }),
    [addFavorite, favorites, isFavorite, removeFavorite, toggleFavorite]
  );

  return <FavoritesContext.Provider value={value}>{children}</FavoritesContext.Provider>;
}

export function useFavorites() {
  const context = useContext(FavoritesContext);
  if (!context) {
    throw new Error("useFavorites must be used within a FavoritesProvider.");
  }
  return context;
}
