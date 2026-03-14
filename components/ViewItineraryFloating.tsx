import { useRouter } from "next/router";
import { useCart } from "../lib/cart-context";

const OPEN_NEW_WITH_DESTINATIONS = "travel-app-open-new-with-destinations";

function generateItineraryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fallback */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function viewItineraryAndNavigate() {
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(OPEN_NEW_WITH_DESTINATIONS, "1");
  }
}

export default function ViewItineraryFloating() {
  const router = useRouter();
  const { cart } = useCart();

  if (cart.length === 0) return null;

  return (
    <button
      type="button"
      className="view-itinerary-floating"
      onClick={() => {
        viewItineraryAndNavigate();
        const id = generateItineraryId();
        router.push(`/saved-trips/${encodeURIComponent(id)}`);
      }}
      aria-label={`View itinerary with ${cart.length} destination${cart.length === 1 ? "" : "s"}`}
    >
      <span className="view-itinerary-floating-icon" aria-hidden>
        ✓
      </span>
      <span className="view-itinerary-floating-label">View itinerary</span>
      <span className="view-itinerary-floating-badge">{cart.length}</span>
    </button>
  );
}
