import { useRouter } from "next/router";

const funnyTravelDogImage =
  "https://images.unsplash.com/photo-1544568100-847a948585b9?auto=format&fit=crop&w=1400&q=80";

function getFeatureLabel(feature: string | string[] | undefined) {
  const raw = Array.isArray(feature) ? feature[0] : feature;
  if (raw === "flights") return "Flights";
  return "Stays";
}

export default function ComingSoonPage() {
  const router = useRouter();
  const featureLabel = getFeatureLabel(router.query.feature);
  const isStays = featureLabel === "Stays";
  const isFlights = featureLabel === "Flights";

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
          <button
            type="button"
            className={`destinations-tab ${isStays ? "destinations-tab-active" : ""}`}
            onClick={() => router.push("/coming-soon?feature=stays")}
          >
            <span aria-hidden="true">🛏️</span>
            <span>Stays</span>
          </button>
          <button
            type="button"
            className={`destinations-tab ${isFlights ? "destinations-tab-active" : ""}`}
            onClick={() => router.push("/coming-soon?feature=flights")}
          >
            <span aria-hidden="true">✈️</span>
            <span>Flights</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab">
            <span aria-hidden="true">💾</span>
            <span>Saved Trips</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/favorites")}>
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/ai-chatbot")}>
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
          </button>
        </nav>

        <div className="destinations-content">
          <section className="coming-soon-card">
            <img src={funnyTravelDogImage} alt="Funny travel companion" className="coming-soon-image" />
            <h1>{featureLabel} Are Not Here Yet</h1>
            <p>
              Right now, we do not have {featureLabel.toLowerCase()} available.
              We may be adding {featureLabel.toLowerCase()} later.
            </p>
          </section>
        </div>
      </section>
    </main>
  );
}
