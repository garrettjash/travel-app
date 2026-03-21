type AttractionDetails = {
  id: number;
  name: string;
  city: string;
  stateProvince: string;
  country: string;
  latitude: number | null;
  longitude: number | null;
  distanceFromPlace: number | null;
  summary: string;
  vibe: string;
  rating: number | null;
  totalCountRatings: number | null;
  credibilityTier: number | null;
  reviewsSummary: string;
  priceLevel: string;
  popularityScore: number | null;
  rawData: string;
  lastRefreshed: string;
  categories: string[];
  imageUrl: string | null;
  imageUrls: string[];
};

type AttractionDetailsModalProps = {
  attraction: AttractionDetails | null;
  isFavorited: boolean;
  isInItinerary: boolean;
  onToggleFavorite: (attraction: AttractionDetails) => void;
  onToggleItinerary: (attraction: AttractionDetails) => void;
  onClose: () => void;
};

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

const PRICE_LEVEL_LABELS: Record<string, string> = {
  "0": "Free",
  "1": "Cheap",
  "2": "Moderate",
  "3": "Expensive",
  "4": "Luxury",
};

function priceLevelLabel(value: string | null | undefined): string {
  if (!value && value !== "0") return "N/A";
  return PRICE_LEVEL_LABELS[value] ?? value;
}

function popularityLabel(score: number | null): { label: string; className: string } {
  if (score === null || !Number.isFinite(score)) return { label: "N/A", className: "popularity-na" };
  const s = Number(score);
  if (s >= 90) return { label: "Very Popular", className: "popularity-very-popular" };
  if (s >= 75) return { label: "Popular", className: "popularity-popular" };
  if (s >= 60) return { label: "Semi-Popular", className: "popularity-semi-popular" };
  return { label: "Unpopular", className: "popularity-unpopular" };
}

function capitalizeCommaList(value: string): string {
  return value
    .split(",")
    .map((item) => {
      const trimmed = item.trim();
      return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    })
    .filter(Boolean)
    .join(", ");
}

function parseRawData(rawData: string) {
  if (!rawData) return null;
  try {
    const parsed = JSON.parse(rawData) as Record<string, unknown>;
    return Object.entries(parsed).filter(([, value]) => value !== null && value !== undefined && String(value).trim() !== "");
  } catch {
    return null;
  }
}

function buildOpenStreetMapEmbedUrl(latitude: number, longitude: number) {
  const delta = 0.01;
  const left = longitude - delta;
  const right = longitude + delta;
  const top = latitude + delta;
  const bottom = latitude - delta;
  return `https://www.openstreetmap.org/export/embed.html?bbox=${left}%2C${bottom}%2C${right}%2C${top}&layer=mapnik&marker=${latitude}%2C${longitude}`;
}

function buildOpenStreetMapLink(latitude: number, longitude: number) {
  return `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=15/${latitude}/${longitude}`;
}

export default function AttractionDetailsModal({
  attraction,
  isFavorited,
  isInItinerary,
  onToggleFavorite,
  onToggleItinerary,
  onClose
}: AttractionDetailsModalProps) {
  if (!attraction) return null;

  const rawDataEntries = parseRawData(attraction.rawData);
  const previewImage = attraction.imageUrls[0] ?? attraction.imageUrl;
  const hasCoordinates = attraction.latitude !== null && attraction.longitude !== null;
  const popularityInfo = popularityLabel(attraction.popularityScore);

  return (
    <div className="attraction-modal-overlay" role="dialog" aria-modal="true" aria-label="Attraction details">
      <div className="attraction-modal-backdrop" onClick={onClose} />
      <section className="attraction-modal-content">
        <div className="attraction-modal-actions">
          <button type="button" className="attraction-modal-close" onClick={onClose}>
            Close
          </button>
        </div>

        {previewImage ? (
          <img src={previewImage} alt={attraction.name} className="attraction-modal-image" loading="lazy" />
        ) : (
          <div className="attraction-modal-image-fallback" aria-hidden="true">No image</div>
        )}

        <div className="attraction-modal-action-row">
          <button
            type="button"
            className={`attraction-modal-favorite ${isFavorited ? "attraction-modal-favorite-active" : ""
              }`}
            onClick={() => onToggleFavorite(attraction)}
            aria-label={isFavorited ? "Unfavorite attraction" : "Favorite attraction"}
          >
            {isFavorited ? "♥" : "♡"}
          </button>
          <button
            type="button"
            className={`attraction-modal-itinerary-button ${isInItinerary ? "attraction-modal-itinerary-button-active" : ""
              }`}
            onClick={() => onToggleItinerary(attraction)}
          >
            {isInItinerary ? "Remove from itinerary" : "Add to itinerary"}
          </button>
        </div>

        <h2>{attraction.name}</h2>
        <p className="attraction-modal-location">{formatLocation(attraction.city, attraction.stateProvince, attraction.country)}</p>

        {attraction.categories.length > 0 && (
          <p className="attraction-modal-categories">{attraction.categories.join(" • ")}</p>
        )}

        {attraction.summary && <p className="attraction-modal-summary">{attraction.summary}</p>}

        <dl className="attraction-modal-grid">
          <div><dt>Vibe</dt><dd>{attraction.vibe ? capitalizeCommaList(attraction.vibe) : "N/A"}</dd></div>
          <div><dt>Rating</dt><dd>{attraction.rating !== null ? `${attraction.rating.toFixed(2)}/10` : "N/A"}</dd></div>
          <div><dt>Total Ratings</dt><dd>{attraction.totalCountRatings ?? "N/A"}</dd></div>
          <div><dt>Price</dt><dd>{priceLevelLabel(attraction.priceLevel)}</dd></div>
          <div>
            <dt>Popularity</dt>
            <dd>
              {attraction.popularityScore != null ? (
                <>
                  <span>{attraction.popularityScore}</span>
                  <span className={`popularity-label ${popularityInfo.className}`}>{popularityInfo.label}</span>
                </>
              ) : (
                "N/A"
              )}
            </dd>
          </div>
        </dl>

        {attraction.reviewsSummary && (
          <>
            <h3 className="attraction-modal-subtitle">Reviews Summary</h3>
            <p className="attraction-modal-summary">{attraction.reviewsSummary}</p>
          </>
        )}

        {hasCoordinates && (
          <>
            <h3 className="attraction-modal-subtitle">Map</h3>
            <div className="attraction-modal-map-wrap">
              <iframe
                title={`${attraction.name} map`}
                src={buildOpenStreetMapEmbedUrl(attraction.latitude as number, attraction.longitude as number)}
                className="attraction-modal-map"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
              />
            </div>
            <a
              className="attraction-modal-map-link"
              href={buildOpenStreetMapLink(attraction.latitude as number, attraction.longitude as number)}
              target="_blank"
              rel="noreferrer"
            >
              Open in Maps
            </a>
          </>
        )}

        {rawDataEntries && rawDataEntries.length > 0 && (
          <>
            <h3 className="attraction-modal-subtitle">Additional Details</h3>
            <dl className="attraction-modal-grid">
              {rawDataEntries.map(([key, value]) => (
                <div key={key}>
                  <dt>{key}</dt>
                  <dd>{String(value)}</dd>
                </div>
              ))}
            </dl>
          </>
        )}
      </section>
    </div>
  );
}
