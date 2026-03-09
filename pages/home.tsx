import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";
import AttractionsExplorer from "../components/AttractionsExplorer";

export default function HomePage() {
  const router = useRouter();
  const placeQuery = router.query.place;
  const initialPlace = Array.isArray(placeQuery) ? placeQuery[0] : placeQuery;

  return (
    <main className="destinations-page">
      <header className="destinations-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <AuthButton />
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/saved-trips")}
          >
            <span aria-hidden="true">💾</span>
            <span>Itinerary</span>
          </button>
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/favorites")}
          >
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/collaborate")}
          >
            <span aria-hidden="true">👥</span>
            <span>Collaborate</span>
          </button>
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/ai-chatbot")}
          >
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
          </button>
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/about")}
          >
            <span aria-hidden="true">ℹ️</span>
            <span>About</span>
          </button>
        </nav>

        <div className="destinations-content">
          <AttractionsExplorer
            title="Top Choices For Your Selections"
            subtitle="Explore attractions based on your filters."
            initialPlace={initialPlace}
          />
        </div>
      </section>
    </main>
  );
}
