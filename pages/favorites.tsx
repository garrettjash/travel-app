import { useState } from "react";
import { useRouter } from "next/router";
import AttractionDetailsModal from "../components/AttractionDetailsModal";
import LoginNoticeModal from "../components/LoginNoticeModal";
import { useFavorites } from "../lib/favorites-context";

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

function formatCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

export default function FavoritesPage() {
  const router = useRouter();
  const { favorites, toggleFavorite, isFavorite } = useFavorites();
  const [imageIndexByAttraction, setImageIndexByAttraction] = useState<Record<number, number>>({});
  const [selectedAttraction, setSelectedAttraction] = useState<(typeof favorites)[number] | null>(null);
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
          <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/saved-trips")}>
            <span aria-hidden="true">💾</span>
            <span>Saved Trips</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/ai-chatbot")}>
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
          </button>
        </nav>

        <div className="destinations-content">
          <header className="attractions-header">
            <h1>Your Favorites</h1>
            <p>Saved for this session only. Refreshing the page clears favorites.</p>
          </header>

          {favorites.length === 0 ? (
            <section className="attractions-results">
              <p className="attractions-state">No favorites yet. Tap the heart on an attraction card to add one.</p>
            </section>
          ) : (
            <section className="attractions-results">
              <p className="attractions-results-meta">Showing {favorites.length} favorite attractions</p>
              <div className="attractions-grid">
                {favorites.map((attraction) => (
                  <article
                    className="attraction-card attraction-card-clickable"
                    key={attraction.id}
                    onClick={() => setSelectedAttraction(attraction)}
                  >
                    {(() => {
                      const urls = attraction.imageUrls.length > 0
                        ? attraction.imageUrls
                        : attraction.imageUrl
                          ? [attraction.imageUrl]
                          : [];
                      const index = imageIndexByAttraction[attraction.id] ?? 0;
                      const currentUrl = urls[index];

                      if (!currentUrl) {
                        return (
                          <div className="attraction-card-image-fallback" aria-hidden="true">
                            No image
                          </div>
                        );
                      }

                      return (
                        <img
                          src={currentUrl}
                          alt={attraction.name}
                          className="attraction-card-image"
                          loading="lazy"
                          onError={() => {
                            setImageIndexByAttraction((current) => ({
                              ...current,
                              [attraction.id]: (current[attraction.id] ?? 0) + 1
                            }));
                          }}
                        />
                      );
                    })()}

                    <div className="attraction-card-top">
                      <div className="attraction-card-title-row">
                        <h2>{attraction.name}</h2>
                        <button
                          type="button"
                          className={`attraction-favorite-button ${
                            isFavorite(attraction.id) ? "attraction-favorite-button-active" : ""
                          }`}
                          onClick={(event) => {
                            event.stopPropagation();
                            toggleFavorite(attraction);
                          }}
                          aria-label={`Remove ${attraction.name} from favorites`}
                        >
                          ♥
                        </button>
                      </div>
                      <p>{formatLocation(attraction.city, attraction.stateProvince, attraction.country)}</p>
                    </div>

                    {attraction.categories.length > 0 && (
                      <p className="attraction-card-categories">
                        {attraction.categories.join(" • ")}
                      </p>
                    )}

                    {attraction.summary && <p className="attraction-card-summary">{attraction.summary}</p>}

                    <dl className="attraction-card-details">
                      <div>
                        <dt>Vibe</dt>
                        <dd>{attraction.vibe ? formatCommaList(attraction.vibe) : "N/A"}</dd>
                      </div>
                      <div>
                        <dt>Rating</dt>
                        <dd>{attraction.rating !== null ? attraction.rating.toFixed(2) : "N/A"}</dd>
                      </div>
                      <div>
                        <dt>Price</dt>
                        <dd>{attraction.priceLevel || "N/A"}</dd>
                      </div>
                    </dl>
                  </article>
                ))}
              </div>
            </section>
          )}
        </div>
      </section>
      <AttractionDetailsModal
        attraction={selectedAttraction}
        isFavorited={selectedAttraction ? isFavorite(selectedAttraction.id) : false}
        onToggleFavorite={toggleFavorite}
        onClose={() => setSelectedAttraction(null)}
      />
      <LoginNoticeModal isOpen={isLoginNoticeOpen} onClose={() => setIsLoginNoticeOpen(false)} />
    </main>
  );
}
