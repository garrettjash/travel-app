import type { AppProps } from "next/app";
import { FavoritesProvider } from "../lib/favorites-context";
import "../styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  return (
    <FavoritesProvider>
      <Component {...pageProps} />
    </FavoritesProvider>
  );
}
