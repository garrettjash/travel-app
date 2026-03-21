import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import ViewItineraryFloating from "../components/ViewItineraryFloating";
import { AuthProvider } from "../lib/auth-context";
import { clearWorkingItinerariesOnReload } from "../lib/working-itinerary-storage";
import { CartProvider } from "../lib/cart-context";
import { FavoritesProvider } from "../lib/favorites-context";
import { ItineraryProvider } from "../lib/itinerary-context";
import { UndoProvider } from "../lib/undo-context";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    clearWorkingItinerariesOnReload();
  }, []);

  return (
    <>
      <Head>
        <link rel="icon" href="/favicon.png" />
      </Head>
      <AuthProvider>
        <FavoritesProvider>
          <CartProvider>
            <ItineraryProvider>
              <UndoProvider>
                <Component {...pageProps} />
                <ViewItineraryFloating />
              </UndoProvider>
            </ItineraryProvider>
          </CartProvider>
        </FavoritesProvider>
      </AuthProvider>
    </>
  );
}
