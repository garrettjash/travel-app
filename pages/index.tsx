import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";

const heroImage =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80";

export default function MarketingHomePage() {
  const router = useRouter();

  return (
    <main className="marketing-home-shell">
      <header className="landing-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <div className="landing-topbar-actions">
          <AuthButton />
        </div>
      </header>

      <section className="marketing-home-hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="marketing-home-overlay" />
        <div className="marketing-home-content">
          <p className="marketing-home-eyebrow">Trip planning in one workspace</p>
          <h1 className="marketing-home-title">Start planning your trip, collaborate with friends, and save itineraries that you can revisit anytime.</h1>
          <p className="marketing-home-copy">
            Explore destinations, build solo plans, spin up group sessions, and keep everything organized in one place.
          </p>

          <div className="marketing-home-actions">
            <button type="button" className="marketing-home-primary" onClick={() => router.push("/planning-options")}>
              Browse the App
            </button>
            <button type="button" className="marketing-home-secondary" onClick={() => router.push("/login")}>
              Login
            </button>
          </div>

          <div className="marketing-home-feature-grid">
            <article className="marketing-home-feature-card">
              <span className="marketing-home-feature-icon" aria-hidden="true">🗺️</span>
              <h2>Plan Faster</h2>
              <p>Choose a solo trip flow or jump straight into destination discovery.</p>
            </article>
            <article className="marketing-home-feature-card">
              <span className="marketing-home-feature-icon" aria-hidden="true">🤝</span>
              <h2>Collaborate</h2>
              <p>Create group planning sessions and coordinate ideas with friends.</p>
            </article>
            <article className="marketing-home-feature-card">
              <span className="marketing-home-feature-icon" aria-hidden="true">💾</span>
              <h2>Save Itineraries</h2>
              <p>Keep favorite stops and saved trip plans ready for the next time you return.</p>
            </article>
          </div>
        </div>
      </section>
    </main>
  );
}
