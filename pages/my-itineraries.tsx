import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";
import { useAuth } from "../lib/auth-context";

type ItineraryListItem = {
  itineraryId: string;
  tripName: string;
  location: string;
};

export default function MyItinerariesPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [itineraries, setItineraries] = useState<ItineraryListItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) {
      if (!loading && !user) {
        router.replace("/login");
      }
      setIsLoading(false);
      return;
    }

    let isActive = true;

    async function loadItineraries() {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        params.set("userId", user!.id);
        const response = await fetch(`/api/itinerary?${params.toString()}`);
        const data = (await response.json()) as { itineraries?: ItineraryListItem[]; error?: string };

        if (!isActive) return;

        if (!response.ok) {
          throw new Error(data.error || "Failed to load itineraries.");
        }

        setItineraries(data.itineraries ?? []);
      } catch (err) {
        if (!isActive) return;
        setItineraries([]);
        setError(err instanceof Error ? err.message : "Failed to load itineraries.");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadItineraries();
    return () => {
      isActive = false;
    };
  }, [user?.id, loading, user, router]);

  if (loading || !user) {
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
          <AuthButton />
        </header>
        <section className="destinations-layout">
          <div className="destinations-content">
            <section className="about-card">
              <p>Loading…</p>
            </section>
          </div>
        </section>
      </main>
    );
  }

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
        <AuthButton />
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/saved-trips")}>
            <span aria-hidden="true">💾</span>
            <span>Itinerary</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">📋</span>
            <span>My Itineraries</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/favorites")}>
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/collaborate")}>
            <span aria-hidden="true">👥</span>
            <span>Collaborate</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/ai-chatbot")}>
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/about")}>
            <span aria-hidden="true">ℹ️</span>
            <span>About</span>
          </button>
        </nav>

        <div className="destinations-content">
          <section className="about-card">
            <h1>My Itineraries</h1>
            {isLoading ? (
              <p>Loading your itineraries…</p>
            ) : error ? (
              <p className="login-page-error">{error}</p>
            ) : itineraries.length === 0 ? (
              <p>You haven&apos;t saved any itineraries yet. Create one from the Itinerary page or Solo Planner.</p>
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                style={{ marginTop: 12 }}
                onClick={() => router.push("/saved-trips")}
              >
                Start planning
              </button>
            ) : (
              <ul className="my-itineraries-list">
                {itineraries.map((item) => (
                  <li key={item.itineraryId}>
                    <button
                      type="button"
                      className="my-itineraries-item"
                      onClick={() => router.push(`/saved-trips/${encodeURIComponent(item.itineraryId)}`)}
                    >
                      <span className="my-itineraries-name">{item.tripName}</span>
                      {item.location && (
                        <span className="my-itineraries-location">{item.location}</span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </section>
    </main>
  );
}
