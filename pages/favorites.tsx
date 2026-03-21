import { useState } from "react";
import AttractionDetailsModal from "../components/AttractionDetailsModal";
import AppShell from "../components/AppShell";
import { useFavorites } from "../lib/favorites-context";
import { useItinerary } from "../lib/itinerary-context";
import { useUndo } from "../lib/undo-context";

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
  const { favorites, isFavorite, addFavorite, removeFavorite } = useFavorites();
  const { addAttraction, removeAttraction, isInItinerary } = useItinerary();
  const { addUndo } = useUndo();
  const [imageIndexByAttraction, setImageIndexByAttraction] = useState<Record<number, number>>({});
  const [selectedAttraction, setSelectedAttraction] = useState<(typeof favorites)[number] | null>(null);

  const handleToggleFavorite = (attraction: (typeof favorites)[number]) => {
    if (isFavorite(attraction.id)) {
      removeFavorite(attraction.id);
      addUndo(`Removed ${attraction.name} from favorites`, () => addFavorite(attraction));
      return;
    }
    addFavorite(attraction);
  };

  return (
    <AppShell activeTab="favorites">
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
                            handleToggleFavorite(attraction);
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

      <AttractionDetailsModal
        attraction={selectedAttraction}
        isFavorited={selectedAttraction ? isFavorite(selectedAttraction.id) : false}
        isInItinerary={selectedAttraction ? isInItinerary(selectedAttraction.id) : false}
        onToggleFavorite={handleToggleFavorite}
        onToggleItinerary={(attraction) => {
          if (isInItinerary(attraction.id)) {
            removeAttraction(attraction.id);
            return;
          }
          addAttraction(attraction);
        }}
        onClose={() => setSelectedAttraction(null)}
      />
    </AppShell>
  );
}
