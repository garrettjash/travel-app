import { useState } from "react";
import { useRouter } from "next/router";

const heroImage =
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80";

export default function LandingPage() {
  const router = useRouter();
  const [destination, setDestination] = useState("");

  return (
    <main className="landing-shell">
      <header className="landing-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <button type="button" className="destinations-login">Login</button>
      </header>
      <section className="landing-hero" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="landing-overlay" />
        <div className="landing-content">
          <h1 className="landing-title">Enter Details About Your Travel</h1>
          <div className="landing-card">
            <div className="landing-input-block">
              <div className="landing-label-row">
                <span className="landing-icon" aria-hidden="true">
                  📍
                </span>
                <span className="landing-label">Destination</span>
              </div>
              <input
                className="landing-input"
                placeholder="Where To?"
                aria-label="Destination"
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
              />
            </div>
          </div>
          <button
            type="button"
            className="landing-go-button"
            onClick={() => {
              const place = destination.trim();
              if (!place) {
                router.push("/home");
                return;
              }
              router.push({ pathname: "/home", query: { place } });
            }}
          >
            <span>Go</span>
            <span aria-hidden="true">→</span>
          </button>
          <button
            type="button"
            className="landing-secondary-button"
            onClick={() => router.push("/home")}
          >
            View all attractions
          </button>
        </div>
      </section>
    </main>
  );
}
