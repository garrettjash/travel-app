import { TouchEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";

type Attraction = {
  id: number;
  name: string;
  city: string;
  country: string;
  summary: string;
  vibe: string;
  rating: number | null;
  priceLevel: string;
  categories: string[];
  imageUrl: string | null;
  imageUrls: string[];
};

type VoteValue = "up" | "down";
type VotesByAttraction = Record<number, VoteValue>;

type SessionPayload = {
  sessionId: string;
  placeId: number;
  place: string;
  attractions: Attraction[];
  error?: string;
};

type VotePayload = {
  votes?: VotesByAttraction;
  success?: boolean;
  error?: string;
};

const SWIPE_THRESHOLD = 40;
const GUEST_STORAGE_KEY = "travelapp_collab_guest_v1";
const GUEST_TTL_MS = 24 * 60 * 60 * 1000;
const LOCAL_VOTE_STORAGE_KEY = "travelapp_collab_votes_v1";

type GuestStorage = {
  id: string;
  expiresAt: number;
};

type LocalVoteStorage = Record<string, VotesByAttraction>;

function sanitizeDestination(rawValue: string | string[] | undefined) {
  const base = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  const value = (base ?? "")
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[^\p{L}\p{N}\s,.'()\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

  return value || "your destination";
}

function sanitizeSessionId(rawValue: string | string[] | undefined) {
  const base = Array.isArray(rawValue) ? rawValue[0] : rawValue;
  return (base ?? "")
    .normalize("NFKC")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 80);
}

function formatLocation(city: string, country: string) {
  if (city && country) return `${city}, ${country}`;
  return city || country || "Location unavailable";
}

function formatCommaList(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .join(", ");
}

function createGuid() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getOrCreateGuestId() {
  if (typeof window === "undefined") return "";

  try {
    const raw = window.localStorage.getItem(GUEST_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as GuestStorage;
      if (parsed?.id && Number.isFinite(parsed.expiresAt) && parsed.expiresAt > Date.now()) {
        return parsed.id;
      }
    }
  } catch {
    // ignore bad local storage
  }

  const nextGuest: GuestStorage = {
    id: createGuid(),
    expiresAt: Date.now() + GUEST_TTL_MS
  };

  window.localStorage.setItem(GUEST_STORAGE_KEY, JSON.stringify(nextGuest));
  return nextGuest.id;
}

function loadLocalVotes(sessionId: string) {
  if (typeof window === "undefined" || !sessionId) return {} as VotesByAttraction;

  try {
    const raw = window.localStorage.getItem(LOCAL_VOTE_STORAGE_KEY);
    if (!raw) return {} as VotesByAttraction;
    const parsed = JSON.parse(raw) as LocalVoteStorage;
    return parsed?.[sessionId] ?? {};
  } catch {
    return {} as VotesByAttraction;
  }
}

function saveLocalVotes(sessionId: string, votes: VotesByAttraction) {
  if (typeof window === "undefined" || !sessionId) return;

  let current: LocalVoteStorage = {};

  try {
    const raw = window.localStorage.getItem(LOCAL_VOTE_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as LocalVoteStorage;
      current = parsed && typeof parsed === "object" ? parsed : {};
    }
  } catch {
    current = {};
  }

  const next: LocalVoteStorage = {
    ...current,
    [sessionId]: votes
  };

  window.localStorage.setItem(LOCAL_VOTE_STORAGE_KEY, JSON.stringify(next));
}

export default function CollaborateSessionPage() {
  const router = useRouter();
  const destinationFromUrl = useMemo(() => sanitizeDestination(router.query.place), [router.query.place]);
  const sessionId = useMemo(() => sanitizeSessionId(router.query.session), [router.query.session]);

  const [guestId, setGuestId] = useState("");
  const [destination, setDestination] = useState(destinationFromUrl);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [votesByAttraction, setVotesByAttraction] = useState<VotesByAttraction>({});
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [voteSavedMessage, setVoteSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    setGuestId(getOrCreateGuestId());
  }, []);

  useEffect(() => {
    if (!router.isReady || !sessionId) return;

    let isActive = true;

    async function loadSession() {
      setIsLoading(true);
      setError(null);
      setVoteSavedMessage(null);

      try {
        const response = await fetch(`/api/collab-session?sessionId=${encodeURIComponent(sessionId)}`);
        const payload = (await response.json()) as SessionPayload;

        if (!isActive) return;

        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Failed to load collab session.");
        }

        setDestination(payload.place || destinationFromUrl);
        setAttractions(payload.attractions ?? []);
        setCurrentIndex(0);
      } catch (loadError) {
        if (!isActive) return;
        setAttractions([]);
        setError(loadError instanceof Error ? loadError.message : "Unknown error loading session");
      } finally {
        if (isActive) setIsLoading(false);
      }
    }

    loadSession();

    return () => {
      isActive = false;
    };
  }, [destinationFromUrl, router.isReady, sessionId]);

  useEffect(() => {
    if (!sessionId) return;
    setVotesByAttraction(loadLocalVotes(sessionId));
  }, [sessionId]);

  useEffect(() => {
    if (!sessionId || !guestId) return;

    let isActive = true;

    async function loadVotesFromSupabase() {
      try {
        const response = await fetch(
          `/api/collab-vote?sessionId=${encodeURIComponent(sessionId)}&guestId=${encodeURIComponent(guestId)}`
        );
        const payload = (await response.json()) as VotePayload;

        if (!isActive || !response.ok || payload.error || !payload.votes) return;

        setVotesByAttraction((current) => {
          const merged = { ...current, ...payload.votes };
          saveLocalVotes(sessionId, merged);
          return merged;
        });
      } catch {
        // keep local cache if request fails
      }
    }

    loadVotesFromSupabase();

    return () => {
      isActive = false;
    };
  }, [guestId, sessionId]);

  const currentAttraction = attractions[currentIndex] ?? null;
  const currentVote = currentAttraction ? votesByAttraction[currentAttraction.id] : undefined;
  const votedCount = attractions.reduce(
    (count, attraction) => (votesByAttraction[attraction.id] ? count + 1 : count),
    0
  );
  const allAttractionsVoted = attractions.length > 0 && votedCount === attractions.length;
  const currentVoteMessage = currentVote === "up" ? "You voted YES" : currentVote === "down" ? "You voted NO" : null;

  async function castVote(vote: VoteValue) {
    if (!currentAttraction || !sessionId || !guestId) return;
    if (votesByAttraction[currentAttraction.id]) return;

    try {
      const response = await fetch("/api/collab-vote", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId,
          guestId,
          attractionId: currentAttraction.id,
          vote: vote === "up"
        })
      });

      const payload = (await response.json()) as VotePayload;

      if (!response.ok) {
        throw new Error(payload.error || "Failed to save vote.");
      }

      const nextVotes = {
        ...votesByAttraction,
        [currentAttraction.id]: vote
      };

      setVotesByAttraction(nextVotes);
      saveLocalVotes(sessionId, nextVotes);
      setVoteSavedMessage(null);

      if (currentIndex < attractions.length - 1) {
        setCurrentIndex((index) => index + 1);
      }
    } catch (voteError) {
      setVoteSavedMessage(voteError instanceof Error ? voteError.message : "Unable to save vote");
    }
  }

  function handleTouchStart(event: TouchEvent<HTMLElement>) {
    setTouchStartX(event.changedTouches[0]?.clientX ?? null);
  }

  function handleTouchEnd(event: TouchEvent<HTMLElement>) {
    const endX = event.changedTouches[0]?.clientX;
    if (touchStartX === null || typeof endX !== "number") return;

    const deltaX = endX - touchStartX;
    setTouchStartX(null);

    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;
    if (deltaX > 0) castVote("up");
    if (deltaX < 0) castVote("down");
  }

  return (
    <main className="destinations-page">
      <header className="destinations-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/collaborate")}
        >
          TravelApp
        </button>
      </header>

      <section className="destinations-content" style={{ padding: "24px" }}>
        <section className="about-card">
          <h1>
            Welcome to your collab session for <span className="destinations-brand">{destination}</span>
          </h1>
        </section>

        {isLoading && (
          <section className="about-card">
            <p className="attractions-state">Loading attractions...</p>
          </section>
        )}

        {error && (
          <section className="about-card">
            <p className="attractions-state attractions-state-error">Error: {error}</p>
          </section>
        )}

        {!isLoading && !error && !currentAttraction && (
          <section className="about-card">
            <p className="attractions-state">No attractions found for this session.</p>
          </section>
        )}

        {!isLoading && !error && currentAttraction && (
          <section className="about-card" style={{ maxWidth: 980 }}>
            {currentVoteMessage && (
              <p style={{ margin: "0 0 10px", color: "#1f8f4a", fontWeight: 600 }}>
                {currentVoteMessage}
              </p>
            )}
            {!currentVoteMessage && voteSavedMessage && (
              <p style={{ margin: "0 0 10px", color: "#1f8f4a", fontWeight: 600 }}>
                {voteSavedMessage}
              </p>
            )}

            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {!allAttractionsVoted && (
                <button
                  type="button"
                  className={`saved-trips-button ${currentVote ? "saved-trips-button-muted" : "saved-trips-button-primary"}`}
                  onClick={() => castVote("down")}
                  disabled={Boolean(currentVote)}
                  aria-label="Thumbs down"
                >
                  👎
                </button>
              )}

              <article
                className="attraction-card"
                style={{ flex: 1, margin: 0 }}
                onTouchStart={handleTouchStart}
                onTouchEnd={handleTouchEnd}
              >
                {currentAttraction.imageUrl ? (
                  <img
                    src={currentAttraction.imageUrl}
                    alt={currentAttraction.name}
                    className="attraction-card-image"
                    loading="lazy"
                  />
                ) : (
                  <div className="attraction-card-image-fallback" aria-hidden="true">
                    No image
                  </div>
                )}

                <div className="attraction-card-top">
                  <div className="attraction-card-title-row">
                    <h2>{currentAttraction.name}</h2>
                  </div>
                  <p>{formatLocation(currentAttraction.city, currentAttraction.country)}</p>
                </div>

                {currentAttraction.categories.length > 0 && (
                  <p className="attraction-card-categories">
                    {currentAttraction.categories.join(" • ")}
                  </p>
                )}

                {currentAttraction.summary && <p className="attraction-card-summary">{currentAttraction.summary}</p>}

                <dl className="attraction-card-details">
                  <div>
                    <dt>Vibe</dt>
                    <dd>{currentAttraction.vibe ? formatCommaList(currentAttraction.vibe) : "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Rating</dt>
                    <dd>{currentAttraction.rating !== null ? currentAttraction.rating.toFixed(2) : "N/A"}</dd>
                  </div>
                  <div>
                    <dt>Price</dt>
                    <dd>{currentAttraction.priceLevel || "N/A"}</dd>
                  </div>
                </dl>
              </article>

              {!allAttractionsVoted && (
                <button
                  type="button"
                  className={`saved-trips-button ${currentVote ? "saved-trips-button-muted" : "saved-trips-button-primary"}`}
                  onClick={() => castVote("up")}
                  disabled={Boolean(currentVote)}
                  aria-label="Thumbs up"
                >
                  👍
                </button>
              )}
            </div>

            <div className="saved-trips-actions" style={{ marginTop: 12, justifyContent: "center", alignItems: "center" }}>
              <button
                type="button"
                className="saved-trips-button"
                onClick={() => setCurrentIndex((index) => Math.max(0, index - 1))}
                disabled={currentIndex === 0}
              >
                Previous
              </button>
              <p className="attractions-state" style={{ margin: 0 }}>
                Card {currentIndex + 1} of {attractions.length}
              </p>
              <button
                type="button"
                className="saved-trips-button"
                onClick={() => setCurrentIndex((index) => Math.min(attractions.length - 1, index + 1))}
                disabled={currentIndex >= attractions.length - 1}
              >
                Next
              </button>
            </div>
          </section>
        )}
      </section>
    </main>
  );
}
