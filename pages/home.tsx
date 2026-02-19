import { useState } from "react";
import { useRouter } from "next/router";
import AttractionsExplorer from "../components/AttractionsExplorer";
import LoginNoticeModal from "../components/LoginNoticeModal";

export default function HomePage() {
  const router = useRouter();
  const placeQuery = router.query.place;
  const initialPlace = Array.isArray(placeQuery) ? placeQuery[0] : placeQuery;
  const [isLoginNoticeOpen, setIsLoginNoticeOpen] = useState(false);

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
        <button type="button" className="destinations-login" onClick={() => setIsLoginNoticeOpen(true)}>
          Login
        </button>
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/coming-soon?feature=stays")}
          >
            <span aria-hidden="true">🛏️</span>
            <span>Stays</span>
          </button>
          <button
            type="button"
            className="destinations-tab"
            onClick={() => router.push("/coming-soon?feature=flights")}
          >
            <span aria-hidden="true">✈️</span>
            <span>Flights</span>
          </button>
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
            <span>Saved Trips</span>
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
            onClick={() => router.push("/ai-chatbot")}
          >
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
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
      <LoginNoticeModal isOpen={isLoginNoticeOpen} onClose={() => setIsLoginNoticeOpen(false)} />
    </main>
  );
}
