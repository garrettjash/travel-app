import type { AppProps } from "next/app";
import { AuthProvider } from "../lib/auth-context";
import { FavoritesProvider } from "../lib/favorites-context";
import { ItineraryProvider } from "../lib/itinerary-context";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <FavoritesProvider>
        <ItineraryProvider>
          <Component {...pageProps} />
        </ItineraryProvider>
      </FavoritesProvider>
    </AuthProvider>
  );
}
