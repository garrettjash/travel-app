import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
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
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(e: React.MouseEvent, item: ItineraryListItem) {
    e.stopPropagation();
    if (
      !window.confirm(
        "Are you sure you want to delete this itinerary? This cannot be undone."
      )
    ) {
      return;
    }
    setDeletingId(item.itineraryId);
    try {
      const params = new URLSearchParams();
      params.set("itineraryId", item.itineraryId);
      params.set("userId", user!.id);
      const response = await fetch(`/api/itinerary?${params.toString()}`, {
        method: "DELETE"
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(data.error || "Failed to delete.");
      setItineraries((prev) =>
        prev.filter((i) => i.itineraryId !== item.itineraryId)
      );
    } catch (err) {
      if (err instanceof Error) {
        window.alert(err.message);
      }
    } finally {
      setDeletingId(null);
    }
  }

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
      <AppShell activeTab="my-itineraries">
        <div className="my-itineraries-page-content">
          <section className="about-card">
            <p>Loading…</p>
          </section>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell activeTab="my-itineraries">
          <div className="my-itineraries-page-content">
          <section className="about-card">
            <h1>My Itineraries</h1>
            {isLoading ? (
              <p>Loading your itineraries…</p>
            ) : error ? (
              <p className="login-page-error">{error}</p>
            ) : itineraries.length === 0 ? (
              <>
                <p>You haven&apos;t saved any itineraries yet. Create one from the Itinerary page or Solo Planner.</p>
                <button
                  type="button"
                  className="saved-trips-button saved-trips-button-primary"
                  style={{ marginTop: 12 }}
                  onClick={() => router.push("/solo-planner")}
                >
                  Start planning
                </button>
              </>
            ) : (
              <ul className="my-itineraries-list">
                {itineraries.map((item) => (
                  <li key={item.itineraryId} className="my-itineraries-row">
                    <button
                      type="button"
                      className="my-itineraries-item"
                      onClick={() =>
                        router.push(`/solo-planner/${encodeURIComponent(item.itineraryId)}`)
                      }
                    >
                      <span className="my-itineraries-name">{item.tripName}</span>
                      {item.location && (
                        <span className="my-itineraries-location">{item.location}</span>
                      )}
                    </button>
                    <button
                      type="button"
                      className="my-itineraries-delete"
                      onClick={(e) => handleDelete(e, item)}
                      disabled={deletingId === item.itineraryId}
                      aria-label="Delete itinerary"
                    >
                      <img
                        src="https://img.icons8.com/fluent-systems-regular/24/FA5252/trash.png"
                        alt=""
                        width={24}
                        height={24}
                      />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </section>
          </div>
    </AppShell>
  );
}
