import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { FavoriteAttraction } from "./favorites-context";

type CartContextValue = {
  cart: FavoriteAttraction[];
  addToCart: (attraction: FavoriteAttraction) => void;
  removeFromCart: (attractionId: number) => void;
  clearCart: () => void;
  isInCart: (attractionId: number) => boolean;
  moveCartToItinerary: (addAttraction: (a: FavoriteAttraction) => void) => void;
};

const CartContext = createContext<CartContextValue | undefined>(undefined);

const CART_STORAGE_KEY = "travel-app-itinerary-cart";

function loadCart(): FavoriteAttraction[] {
  try {
    const raw = typeof window !== "undefined" ? window.localStorage.getItem(CART_STORAGE_KEY) : null;
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as FavoriteAttraction[];
  } catch {
    return [];
  }
}

function saveCart(items: FavoriteAttraction[]) {
  try {
    if (typeof window !== "undefined") {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(items));
    }
  } catch {
    // ignore
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<FavoriteAttraction[]>([]);

  useEffect(() => {
    setCart(loadCart());
  }, []);

  useEffect(() => {
    saveCart(cart);
  }, [cart]);

  const addToCart = useCallback((attraction: FavoriteAttraction) => {
    setCart((current) => {
      if (current.some((item) => item.id === attraction.id)) return current;
      return [...current, attraction];
    });
  }, []);

  const removeFromCart = useCallback((attractionId: number) => {
    setCart((current) => current.filter((item) => item.id !== attractionId));
  }, []);

  const clearCart = useCallback(() => {
    setCart([]);
  }, []);

  const isInCart = useCallback(
    (attractionId: number) => cart.some((item) => item.id === attractionId),
    [cart]
  );

  const moveCartToItinerary = useCallback(
    (addAttraction: (a: FavoriteAttraction) => void) => {
      cart.forEach(addAttraction);
      setCart([]);
    },
    [cart]
  );

  const value = useMemo(
    () => ({
      cart,
      addToCart,
      removeFromCart,
      clearCart,
      isInCart,
      moveCartToItinerary
    }),
    [cart, addToCart, removeFromCart, clearCart, isInCart, moveCartToItinerary]
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart() {
  const context = useContext(CartContext);
  if (!context) {
    throw new Error("useCart must be used within a CartProvider.");
  }
  return context;
}
