import { useState } from "react";
import { useRouter } from "next/router";

const heroImage =
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80";

export default function LandingPage() {
  const router = useRouter();
  const [guests, setGuests] = useState(67);

  return (
    <main className="landing-shell">
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
              />
            </div>
            <div className="landing-input-block">
              <div className="landing-label-row">
                <span className="landing-icon" aria-hidden="true">
                  📅
                </span>
                <span className="landing-label">Dates</span>
              </div>
              <input
                className="landing-input"
                placeholder="Departure & Return"
                aria-label="Dates"
              />
            </div>
            <div className="landing-input-block">
              <div className="landing-label-row">
                <span className="landing-icon" aria-hidden="true">
                  👤
                </span>
                <span className="landing-label">Guests</span>
              </div>
              <div className="landing-guest-row">
                <button
                  type="button"
                  className="landing-guest-button"
                  onClick={() => setGuests((value) => Math.max(1, value - 1))}
                  aria-label="Decrease guests"
                >
                  -
                </button>
                <span className="landing-guest-count">{guests}</span>
                <button
                  type="button"
                  className="landing-guest-button"
                  onClick={() => setGuests((value) => value + 1)}
                  aria-label="Increase guests"
                >
                  +
                </button>
              </div>
            </div>
          </div>
          <button
            type="button"
            className="landing-go-button"
            onClick={() => router.push("/home")}
          >
            <span>Go</span>
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </section>
    </main>
  );
}
