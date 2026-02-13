import { useRouter } from "next/router";
import AttractionsExplorer from "../components/AttractionsExplorer";

export default function HomePage() {
  const router = useRouter();

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
        <button type="button" className="destinations-login">Login</button>
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button type="button" className="destinations-tab">
            <span aria-hidden="true">🛏️</span>
            <span>Stays</span>
          </button>
          <button type="button" className="destinations-tab">
            <span aria-hidden="true">✈️</span>
            <span>Flights</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab">
            <span aria-hidden="true">💾</span>
            <span>Saved Trips</span>
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
          />
        </div>
      </section>
    </main>
  );
}
