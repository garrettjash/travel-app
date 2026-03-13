import { useRouter } from "next/router";
import { useEffect, useState } from "react";
import AuthButton from "../components/AuthButton";
import { useAuth } from "../lib/auth-context";

const heroImage =
  "https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=1600&q=80";
const COOKIE_CONSENT_KEY = "travelapp-cookie-consent";

export default function MarketingHomePage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [showCookieNotice, setShowCookieNotice] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setShowCookieNotice(window.localStorage.getItem(COOKIE_CONSENT_KEY) !== "accepted");
  }, []);

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
          <AuthButton loginHref="/login?next=%2Fmy-itineraries" />
        </div>
      </header>

      <section className="marketing-home-hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="marketing-home-overlay" />
        <div className="marketing-home-content">
          <p className="marketing-home-eyebrow">Trip planning in one workspace</p>
          <h1 className="marketing-home-title">Plan trips without the clutter.</h1>
          <p className="marketing-home-copy">
            Explore destinations, build solo plans, spin up group sessions, and keep everything organized in one place.
          </p>

          <div className="marketing-home-actions">
            <button type="button" className="marketing-home-primary" onClick={() => router.push("/planning-options")}>
              Browse the App
            </button>
            <button
              type="button"
              className="marketing-home-secondary"
              onClick={() => router.push(user ? "/my-itineraries" : "/login?next=%2Fmy-itineraries")}
              disabled={loading}
            >
              {loading ? "Loading..." : user ? "View My Trips" : "Login"}
            </button>
          </div>

          <div className="marketing-home-feature-grid">
            <article className="marketing-home-feature-card">
              <h2>Plan Faster</h2>
              <p>Choose a solo trip flow or jump straight into destination discovery.</p>
            </article>
            <article className="marketing-home-feature-card">
              <h2>Collaborate</h2>
              <p>Create group planning sessions and coordinate ideas with friends.</p>
            </article>
            <article className="marketing-home-feature-card">
              <h2>Save Itineraries</h2>
              <p>Keep favorite stops and saved trip plans ready for the next time you return.</p>
            </article>
          </div>
        </div>
      </section>
      {showCookieNotice && (
        <div className="cookie-banner" role="dialog" aria-live="polite" aria-label="Cookie notice">
          <div className="cookie-banner-copy">
            <strong>Cookies notice</strong>
            <p>
              This site uses cookies to support login, saved preferences, and a smoother trip-planning experience.
              Please accept cookies to continue using the app.
            </p>
          </div>
          <button
            type="button"
            className="cookie-banner-accept"
            onClick={() => {
              if (typeof window !== "undefined") {
                window.localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
              }
              setShowCookieNotice(false);
            }}
          >
            Accept
          </button>
        </div>
      )}
    </main>
  );
}
