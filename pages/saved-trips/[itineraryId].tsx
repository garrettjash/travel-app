import { FormEvent, useEffect, useState } from "react";
import type { NextPage } from "next";
import { useRouter } from "next/router";
import AppShell from "../../components/AppShell";
import SavedTripBuilder, { SavedItinerary } from "../../components/SavedTripBuilder";
import { useAuth } from "../../lib/auth-context";

const ItineraryPage: NextPage = () => {
  const router = useRouter();
  const { itineraryId } = router.query;
  const { user } = useAuth();
  const [initialItinerary, setInitialItinerary] = useState<SavedItinerary | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [needsShareCode, setNeedsShareCode] = useState(false);
  const [shareCodeInput, setShareCodeInput] = useState("");
  const [shareCodeError, setShareCodeError] = useState<string | null>(null);

  useEffect(() => {
    const idParam = Array.isArray(itineraryId) ? itineraryId[0] : itineraryId;
    if (!idParam) return;

    let isActive = true;

    async function loadItinerary() {
      setIsLoading(true);
      setLoadError(null);
      setNeedsShareCode(false);
      setShareCodeError(null);

      try {
        const params = new URLSearchParams();
        params.set("itineraryId", String(idParam));
        if (user?.id) {
          params.set("userId", user.id);
        }
        const response = await fetch(`/api/itinerary?${params.toString()}`);
        const data = (await response.json()) as { itinerary?: SavedItinerary; error?: string };

        if (!isActive) return;

        if (response.status === 403 && !user?.id) {
          // Share code required for anonymous user
          setInitialItinerary(null);
          setNeedsShareCode(true);
          return;
        }

        if (!response.ok) {
          if (response.status === 404) {
            setInitialItinerary(null);
            setLoadError(null);
            return;
          }
          throw new Error(data.error || "Unable to load itinerary.");
        }

        if (!data.itinerary) {
          setInitialItinerary(null);
          setLoadError(null);
          return;
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
  }, [itineraryId, user?.id]);

  async function handleShareCodeSubmit(event: FormEvent) {
    event.preventDefault();
    setShareCodeError(null);

    const idParam = Array.isArray(itineraryId) ? itineraryId[0] : itineraryId;
    if (!idParam) return;

    try {
      const params = new URLSearchParams();
      params.set("itineraryId", String(idParam));
      params.set("shareCode", shareCodeInput.trim());
      const response = await fetch(`/api/itinerary?${params.toString()}`);
      const data = (await response.json()) as { itinerary?: SavedItinerary; error?: string };

      if (!response.ok || !data.itinerary) {
        throw new Error(data.error || "Invalid share code.");
      }

      setInitialItinerary(data.itinerary);
      setNeedsShareCode(false);
      setShareCodeError(null);
    } catch (error) {
      setShareCodeError(error instanceof Error ? error.message : "Invalid share code.");
    }
  }

  if (isLoading) {
    return (
      <AppShell>
        <section className="about-card">
          <h1>Loading itinerary...</h1>
          <p>Please wait a moment.</p>
        </section>
      </AppShell>
    );
  }

  if (needsShareCode) {
    return (
      <AppShell>
        <section className="about-card">
          <h1>Enter share code</h1>
          <p>This itinerary is protected. Ask the owner for the 6-digit share code to view and edit it.</p>
          <form onSubmit={handleShareCodeSubmit} className="planning-solo-form">
            <label className="planning-solo-label" htmlFor="itinerary-share-code">
              Share code
            </label>
            <div className="planning-solo-input-row">
              <input
                id="itinerary-share-code"
                className="planning-solo-input"
                value={shareCodeInput}
                onChange={(e) => setShareCodeInput(e.target.value)}
                maxLength={12}
                placeholder="6-digit code"
              />
              <button type="submit" className="planning-solo-next">
                Continue
              </button>
            </div>
            {shareCodeError && (
              <p className="chat-error" style={{ marginTop: 6 }}>
                {shareCodeError}
              </p>
            )}
          </form>
        </section>
      </AppShell>
    );
  }

  if (loadError) {
    const newId =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    return (
      <AppShell>
        <section className="about-card">
          <h1>Itinerary not available</h1>
          <p>{loadError}</p>
          <button
            type="button"
            className="saved-trips-button saved-trips-button-primary"
            onClick={() => router.push(`/saved-trips/${encodeURIComponent(newId)}`)}
          >
            Start a new trip
          </button>
        </section>
      </AppShell>
    );
  }

  const idParam = Array.isArray(itineraryId) ? itineraryId[0] : itineraryId;
  return (
    <SavedTripBuilder
      initialItinerary={initialItinerary}
      itineraryIdFromRoute={String(idParam ?? "")}
    />
  );
};

export default ItineraryPage;
