import { useRouter } from "next/router";
import { useCart } from "../lib/cart-context";

const OPEN_NEW_WITH_DESTINATIONS = "travel-app-open-new-with-destinations";

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
        router.push("/saved-trips");
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
