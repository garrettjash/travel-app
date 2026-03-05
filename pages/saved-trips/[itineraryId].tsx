import { useEffect, useState } from "react";
import type { NextPage } from "next";
import { useRouter } from "next/router";
import SavedTripBuilder, { SavedItinerary } from "../../components/SavedTripBuilder";
import LoginNoticeModal from "../../components/LoginNoticeModal";

const ItineraryPage: NextPage = () => {
  const router = useRouter();
  const { itineraryId } = router.query;
  const [initialItinerary, setInitialItinerary] = useState<SavedItinerary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoginNoticeOpen, setIsLoginNoticeOpen] = useState(false);

  useEffect(() => {
    const idParam = Array.isArray(itineraryId) ? itineraryId[0] : itineraryId;
    if (!idParam) return;

    let isActive = true;

    async function loadItinerary() {
      setIsLoading(true);
      setLoadError(null);

      try {
        const params = new URLSearchParams();
        params.set("itineraryId", String(idParam));
        const response = await fetch(`/api/itinerary?${params.toString()}`);
        const data = (await response.json()) as { itinerary?: SavedItinerary; error?: string };

        if (!isActive) return;

        if (!response.ok || !data.itinerary) {
          throw new Error(data.error || "Unable to load itinerary.");
        }

        setInitialItinerary(data.itinerary);
      } catch (error) {
        if (!isActive) return;
        setInitialItinerary(null);
        setLoadError(error instanceof Error ? error.message : "Unknown error loading itinerary.");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadItinerary();

    return () => {
      isActive = false;
    };
  }, [itineraryId]);

  if (isLoading) {
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
            <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
              <span aria-hidden="true">🗺️</span>
              <span>Destinations</span>
            </button>
            <button type="button" className="destinations-tab destinations-tab-active">
              <span aria-hidden="true">💾</span>
              <span>Itinerary</span>
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
              <h1>Loading itinerary...</h1>
              <p>Please wait a moment.</p>
            </section>
          </div>
        </section>
        <LoginNoticeModal isOpen={isLoginNoticeOpen} onClose={() => setIsLoginNoticeOpen(false)} />
      </main>
    );
  }

  if (loadError) {
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
            <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
              <span aria-hidden="true">🗺️</span>
              <span>Destinations</span>
            </button>
            <button type="button" className="destinations-tab destinations-tab-active">
              <span aria-hidden="true">💾</span>
              <span>Itinerary</span>
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
              <h1>Itinerary not available</h1>
              <p>{loadError}</p>
              <button
                type="button"
                className="saved-trips-button saved-trips-button-primary"
                onClick={() => router.push("/saved-trips")}
              >
                Start a new trip
              </button>
            </section>
          </div>
        </section>
        <LoginNoticeModal isOpen={isLoginNoticeOpen} onClose={() => setIsLoginNoticeOpen(false)} />
      </main>
    );
  }

  return <SavedTripBuilder initialItinerary={initialItinerary} itineraryIdFromRoute={String(itineraryId ?? "")} />;
};

export default ItineraryPage;

