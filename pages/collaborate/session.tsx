import { TouchEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "../../components/AuthButton";
import { useAuth } from "../../lib/auth-context";

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

type SessionAttractionResult = {
  attractionId: number;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
};

type SessionPayload = {
  sessionId: string;
  placeId: number;
  place: string;
  attractions: Attraction[];
  decks?: Array<{
    placeId: number;
    placeName: string;
    attractions: Attraction[];
    subdecks?: { label: string; ids: number[] }[];
  }>;
  isExpired?: boolean;
  results?: SessionAttractionResult[];
  itineraryPath?: string;
  expiresAt?: string;
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

function formatExpiryIsoToLocal(iso: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(d);
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
  const { user } = useAuth();
  const destinationFromUrl = useMemo(() => sanitizeDestination(router.query.place), [router.query.place]);
  const sessionId = useMemo(() => sanitizeSessionId(router.query.session), [router.query.session]);

  const [guestId, setGuestId] = useState("");
  const [destination, setDestination] = useState(destinationFromUrl);
  const [itineraryPath, setItineraryPath] = useState<string | null>(null);
  const [expiresAtIso, setExpiresAtIso] = useState<string | null>(null);
  const [attractions, setAttractions] = useState<Attraction[]>([]);
  const [decks, setDecks] = useState<SessionPayload["decks"] | null>(null);
  const [selectedDeckIndex, setSelectedDeckIndex] = useState<number | null>(null);
  const [selectedSubdeckIndex, setSelectedSubdeckIndex] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'decks' | 'subdecks' | 'cardsFocused'>('decks');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [votesByAttraction, setVotesByAttraction] = useState<VotesByAttraction>({});
  const [resultsByAttraction, setResultsByAttraction] = useState<Record<number, SessionAttractionResult>>({});
  const [isSessionExpired, setIsSessionExpired] = useState(false);
  const [touchStartX, setTouchStartX] = useState<number | null>(null);
  const [voteSavedMessage, setVoteSavedMessage] = useState<string | null>(null);

  async function refreshSession() {
    if (!sessionId) return;
    setIsLoading(true);
    setError(null);
    setVoteSavedMessage(null);

    try {
      const params = new URLSearchParams();
      params.set("sessionId", sessionId);
      if (user?.id) params.set("userId", user.id);
      const response = await fetch(`/api/collab-session?${params.toString()}`);
      const payload = (await response.json()) as SessionPayload;

      const legacyExpired =
        !response.ok &&
        typeof payload.error === "string" &&
        payload.error.toLowerCase().includes("expired");

      if (legacyExpired) {
        setDestination(destinationFromUrl);
        setAttractions([]);
        setIsSessionExpired(true);
        setResultsByAttraction({});
        setItineraryPath(null);
        setCurrentIndex(0);
        return;
      }

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Failed to load collab session.");
      }

      setDestination(payload.place || destinationFromUrl);
      const incomingAttractions = payload.attractions ?? [];
      setAttractions(incomingAttractions);

      // Prefer server-provided decks, but if none present build simple decks client-side
      const serverDecks = (payload as any).decks ?? null;
      if (serverDecks && Array.isArray(serverDecks) && serverDecks.length > 0) {
        setDecks(serverDecks);
        setSelectedDeckIndex(0);
        setSelectedSubdeckIndex(null);
      } else {
        // Build decks grouped by city/country (fall back) so UI isn't empty
        const map = new Map<string, Attraction[]>();
        for (const a of incomingAttractions) {
          const key = `${a.city || a.country || "unknown"}`;
          const arr = map.get(key) ?? [];
          arr.push(a);
          map.set(key, arr);
        }

        const built = Array.from(map.entries()).map(([k, items]) => ({ placeId: 0, placeName: k, attractions: items }));
        setDecks(built.length > 0 ? built : null);
        setSelectedDeckIndex(built.length > 0 ? 0 : null);
        setSelectedSubdeckIndex(null);
      }
      setExpiresAtIso(payload.expiresAt ?? null);
      setIsSessionExpired(Boolean(payload.isExpired));
      setItineraryPath(payload.itineraryPath ?? null);
      setResultsByAttraction(
        Object.fromEntries((payload.results ?? []).map((item) => [item.attractionId, item]))
      );
      setCurrentIndex(0);
    } catch (loadError) {
      setAttractions([]);
      setIsSessionExpired(false);
      setResultsByAttraction({});
      setError(loadError instanceof Error ? loadError.message : "Unknown error loading session");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setGuestId(getOrCreateGuestId());
  }, []);

  useEffect(() => {
    if (!router.isReady || !sessionId) return;
    let cancelled = false;
    (async () => {
      await refreshSession();
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [destinationFromUrl, router.isReady, sessionId, user?.id]);

  // When we have an expiry time, refetch right after it flips to expired.
  // This makes sure the server applies poll results into the linked itinerary
  // without requiring the user to click through.
  useEffect(() => {
    if (!expiresAtIso || isSessionExpired) return;
    const expiryMs = Date.parse(expiresAtIso);
    if (!Number.isFinite(expiryMs)) return;
    const delay = Math.max(250, expiryMs - Date.now() + 250);
    const t = window.setTimeout(() => {
      void refreshSession();
    }, delay);
    return () => window.clearTimeout(t);
  }, [expiresAtIso, isSessionExpired, sessionId, user?.id]);

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

  const displayedAttractions = useMemo(() => {
    // pick base list from decks if present and a deck is selected
    let base: Attraction[] = attractions;
    if (decks && selectedDeckIndex !== null && decks[selectedDeckIndex]) {
      base = decks[selectedDeckIndex].attractions ?? [];
      // if a subdeck is selected, filter to those ids
      if (selectedSubdeckIndex !== null && decks[selectedDeckIndex].subdecks && decks[selectedDeckIndex].subdecks[selectedSubdeckIndex]) {
        const ids = new Set(decks[selectedDeckIndex].subdecks![selectedSubdeckIndex].ids.map(Number));
        base = base.filter((a) => ids.has(a.id));
      }
    }

    if (!isSessionExpired) return base;

    return base
      .filter((attraction) => {
        const result = resultsByAttraction[attraction.id];
        if (!result) return false;
        return result.yesVotes > result.noVotes;
      })
      .sort((left, right) => {
        const leftYes = resultsByAttraction[left.id]?.yesVotes ?? 0;
        const rightYes = resultsByAttraction[right.id]?.yesVotes ?? 0;
        return rightYes - leftYes;
      });
  }, [attractions, decks, selectedDeckIndex, selectedSubdeckIndex, isSessionExpired, resultsByAttraction]);
  const rankedVoteRows = useMemo(() => {
    const attractionById = new Map(attractions.map((attraction) => [attraction.id, attraction]));
    return Object.values(resultsByAttraction)
      .map((result) => ({
        result,
        attraction: attractionById.get(result.attractionId)
      }))
      .filter((row): row is { result: SessionAttractionResult; attraction: Attraction } => Boolean(row.attraction))
      .sort((left, right) => {
        // Rank by thumbs up (yesVotes) only — ignore undecideds
        if (right.result.yesVotes !== left.result.yesVotes) {
          return right.result.yesVotes - left.result.yesVotes;
        }
        // Tie-break by fewer thumbs down
        return left.result.noVotes - right.result.noVotes;
      });
  }, [attractions, resultsByAttraction]);
  const maxYesVotes = useMemo(
    () => Math.max(1, ...rankedVoteRows.map((row) => row.result.yesVotes)),
    [rankedVoteRows]
  );

  const currentAttraction = displayedAttractions[currentIndex] ?? null;
  const currentVote = currentAttraction ? votesByAttraction[currentAttraction.id] : undefined;
  const currentResult = currentAttraction ? resultsByAttraction[currentAttraction.id] : undefined;
  const votedCount = displayedAttractions.reduce(
    (count, attraction) => (votesByAttraction[attraction.id] ? count + 1 : count),
    0
  );
  const allAttractionsVoted = displayedAttractions.length > 0 && votedCount === displayedAttractions.length;
  const currentVoteMessage = currentVote === "up" ? "You voted YES" : currentVote === "down" ? "You voted NO" : null;

  useEffect(() => {
    setCurrentIndex((index) => {
      if (displayedAttractions.length === 0) return 0;
      return Math.min(index, displayedAttractions.length - 1);
    });
  }, [displayedAttractions.length]);

  // reset card index when deck/subdeck selection changes
  useEffect(() => {
    setCurrentIndex(0);
  }, [selectedDeckIndex, selectedSubdeckIndex]);

  async function castVote(vote: VoteValue) {
    if (!currentAttraction || !sessionId || !guestId || isSessionExpired) return;
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

      if (currentIndex < displayedAttractions.length - 1) {
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
    if (isSessionExpired) return;
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
        <div />
        <div className="destinations-topbar-actions">
          <AuthButton />
        </div>
      </header>

      <section
        className="destinations-content"
        style={{
          padding: "24px",
          display: "flex",
          flexDirection: "row",
          gap: 24,
          alignItems: "flex-start",
          maxWidth: 1200,
          margin: "0 auto"
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
        <section className="about-card" style={{ marginLeft: "auto", marginRight: "auto", textAlign: "center" }}>
          <h1>
            Welcome to your collab session for <span className="destinations-brand">{destination}</span>
          </h1>
          {!isLoading && expiresAtIso && (
            <p style={{ marginTop: 8, color: "#6b7280", fontSize: 13 }}>
              Link expires: {formatExpiryIsoToLocal(expiresAtIso)}
            </p>
          )}
          {!isLoading && !error && isSessionExpired && (
            <div
              style={{
                marginTop: 16,
                padding: 16,
                background: "#f0f7ff",
                borderLeft: "4px solid #2563eb",
                borderRadius: 8
              }}
            >
              <p style={{ margin: "0 0 8px", fontWeight: 600, color: "#1e40af" }}>
                Voting link expired
              </p>
              <p style={{ margin: 0, color: "#374151" }}>
                You can view the results below. The user who created the session can view these results in the &apos;My Itineraries&apos; section of their profile, and can share the itinerary from there as well.
                {itineraryPath && (
                  <>
                    {" "}
                    Or{" "}
                    <button
                      type="button"
                      className="saved-trips-button saved-trips-button-primary"
                      style={{ marginLeft: 4, display: "inline-block" }}
                      onClick={() => router.push(itineraryPath)}
                    >
                      view your itinerary
                    </button>
                  </>
                )}
              </p>
            </div>
          )}
        </section>

        {/* Deck selector */}
        {!isLoading && !error && decks && decks.length > 0 && (
          <section
            className="about-card"
            style={{
              marginTop: 12,
              maxWidth: 980,
              marginLeft: 'auto',
              marginRight: 'auto',
              paddingBottom: viewMode === 'cardsFocused' ? 12 : 28,
              minHeight: viewMode === 'cardsFocused' ? 72 : 240,
              transition: 'min-height 220ms ease, padding 220ms ease'
            }}
          >
            {viewMode !== 'cardsFocused' && (
              <div style={{ textAlign: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 16 }}>Choose a place deck</strong>
              </div>
            )}

            {/* Deck fan (only in decks view) */}
            {viewMode === 'decks' && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 8 }}>
                <div style={{ position: 'relative', height: 160, width: Math.min(1000, decks.length * 180), display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                  {decks.map((d, i) => {
                    const center = (decks.length - 1) / 2;
                    const offset = i - center;
                    const rotate = offset * 6;
                    const translateY = -Math.abs(offset) * 6;
                    return (
                      <button
                        key={i}
                        onClick={() => {
                          setSelectedDeckIndex(i);
                          setSelectedSubdeckIndex(null);
                          // if deck has no subdecks, go straight to focused cards
                          if (!d.subdecks || d.subdecks.length === 0) {
                            setViewMode('cardsFocused');
                          } else {
                            setViewMode('subdecks');
                          }
                        }}
                        style={{
                          position: 'absolute',
                          left: '50%',
                          transform: `translateX(${offset * 140 - 50}%) rotate(${rotate}deg) translateY(${translateY}px)`,
                          transformOrigin: 'bottom center',
                          width: 220,
                          height: 140,
                          padding: 8,
                          boxShadow: selectedDeckIndex === i ? '0 8px 20px rgba(0,0,0,0.12)' : '0 6px 14px rgba(0,0,0,0.08)',
                          borderRadius: 12,
                          border: selectedDeckIndex === i ? '2px solid #2563eb' : '1px solid #e6edf3',
                          background: '#ffffff',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          justifyContent: 'space-between',
                          alignItems: 'stretch',
                          overflow: 'hidden'
                        }}
                      >
                        {/* top: place name */}
                        <div style={{ fontWeight: 700, fontSize: 14, textAlign: 'left', marginBottom: 4 }}>{d.placeName || `Place ${i + 1}`}</div>
                        {/* middle: small preview image from first attraction if available */}
                        <div style={{ flex: 1, background: '#f3f7fb', borderRadius: 8, overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                          {d.attractions && d.attractions[0] && d.attractions[0].imageUrl ? (
                            <img src={d.attractions[0].imageUrl} alt={d.placeName} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div style={{ color: '#9ca3af' }}>No image</div>
                          )}
                        </div>
                        {/* bottom: count */}
                        <div style={{ marginTop: 6, textAlign: 'right', fontSize: 13, color: '#374151' }}>{(d.attractions || []).length} items</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Subdeck grid: show when a deck is selected and we're in subdecks view */}
            {selectedDeckIndex !== null && decks[selectedDeckIndex] && decks[selectedDeckIndex].subdecks && viewMode === 'subdecks' && (
              <div style={{ padding: 8, marginTop: 12 }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 8 }}>
                  <button
                    type="button"
                    onClick={() => {
                      // go back to place deck selection
                      setSelectedSubdeckIndex(null);
                      setSelectedDeckIndex(null);
                      setViewMode('decks');
                    }}
                    className="saved-trips-button"
                  >
                    ← Back to decks
                  </button>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 18, justifyItems: 'center', padding: '8px 16px' }}>
                  {decks[selectedDeckIndex].subdecks!.map((s, si) => {
                    const firstId = Array.isArray(s.ids) && s.ids.length > 0 ? Number(s.ids[0]) : null;
                    const previewAttraction = firstId ? (decks[selectedDeckIndex].attractions || []).find((a) => Number(a.id) === firstId) : null;
                    const previewImage = previewAttraction?.imageUrl ?? null;
                    const ids = (s.ids || []).map(Number);
                    const allVotedForSubdeck = ids.length > 0 && ids.every((id) => Boolean(votesByAttraction[id]));

                    // compute slight fan tilt per column (max 5 columns)
                    const colIndex = si % 5;
                    const colCenter = 2; // center column index
                    const colOffset = colIndex - colCenter;
                    const rotate = colOffset * 6;
                    const translateY = -Math.abs(colOffset) * 6;

                    return (
                      <div key={si} style={{ width: 170, textAlign: 'center' }}>
                        <button
                          onClick={() => {
                            setSelectedSubdeckIndex(si);
                            setViewMode('cardsFocused');
                          }}
                          style={{
                            width: 170,
                            height: 160,
                            padding: 0,
                            boxShadow: selectedSubdeckIndex === si ? '0 10px 26px rgba(0,0,0,0.14)' : '0 6px 18px rgba(0,0,0,0.08)',
                            borderRadius: 12,
                            border: selectedSubdeckIndex === si ? '2px solid #2563eb' : '1px solid #e6edf3',
                            background: '#fff',
                            cursor: 'pointer',
                            display: 'flex',
                            flexDirection: 'column',
                            justifyContent: 'space-between',
                            transition: 'transform 220ms ease',
                            transform: `rotate(${rotate}deg) translateY(${translateY}px)`,
                            transformOrigin: 'bottom center'
                          }}
                        >
                          <div style={{ height: 88, overflow: 'hidden', borderTopLeftRadius: 12, borderTopRightRadius: 12 }}>
                            {previewImage ? (
                              <img src={previewImage} alt={s.label} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                            ) : (
                              <div style={{ width: '100%', height: '100%', background: '#f3f7fb', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#9ca3af' }}>No image</div>
                            )}
                          </div>
                          <div style={{ padding: '8px 10px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 700, fontSize: 13, lineHeight: '1.1', textAlign: 'left' }}>{s.label}</div>
                            <div style={{ color: '#374151', fontSize: 13 }}>{ids.length}</div>
                          </div>
                        </button>
                        {allVotedForSubdeck && (
                          <div style={{ color: '#1f8f4a', fontSize: 12, marginTop: 6 }}>Already voted</div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Back button when focused */}
            {viewMode === 'cardsFocused' && (
              <div style={{ display: 'flex', justifyContent: 'center', marginTop: 12 }}>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
                  <button
                    type="button"
                    onClick={() => {
                      // Prefer returning to subdecks for the current deck if available, otherwise to the decks list
                      if (selectedDeckIndex !== null && decks?.[selectedDeckIndex]?.subdecks && decks[selectedDeckIndex].subdecks!.length > 0) {
                        setSelectedSubdeckIndex(null); // clear the subdeck selection
                        setViewMode('subdecks');
                      } else {
                        setSelectedSubdeckIndex(null);
                        setSelectedDeckIndex(null);
                        setViewMode('decks');
                      }
                    }}
                    className="saved-trips-button"
                  >
                    ← Back to decks
                  </button>
                  <div style={{ color: '#374151', fontSize: 14 }}>
                    Currently viewing: {
                      selectedDeckIndex !== null
                        ? `${decks?.[selectedDeckIndex]?.placeName ?? 'Place'}${selectedSubdeckIndex !== null && decks?.[selectedDeckIndex]?.subdecks ? ` — ${decks[selectedDeckIndex].subdecks![selectedSubdeckIndex].label}` : ''}`
                        : 'All attractions'
                    }
                  </div>
                </div>
              </div>
            )}

            {viewMode !== 'cardsFocused' && (
              <div style={{ marginTop: 8, textAlign: 'center', color: '#6b7280', fontSize: 13 }}>
                Decks: {decks.map((d) => d.placeName || '').filter(Boolean).join(' • ')}
              </div>
            )}
          </section>
        )}

        {isLoading && (
          <section className="about-card" style={{ maxWidth: 980, marginLeft: 'auto', marginRight: 'auto', textAlign: 'center' }}>
            <p className="attractions-state">Loading attractions...</p>
          </section>
        )}

        {error && (
          <section className="about-card">
            <p className="attractions-state attractions-state-error">Error: {error}</p>
          </section>
        )}

        {!isLoading && !error && !currentAttraction && !isSessionExpired && (
          <section className="about-card">
            <p className="attractions-state">
              No attractions found for this session.
            </p>
          </section>
        )}

        {!isLoading && !error && isSessionExpired && (
          <section className="about-card" style={{ maxWidth: 980, marginLeft: "auto", marginRight: "auto" }}>
            <p style={{ margin: "0 0 10px", color: "#1f8f4a", fontWeight: 600 }}>
              Polling is no longer live. Results are ranked by thumbs up (👍).
            </p>
            {rankedVoteRows.length === 0 ? (
              <p className="attractions-state">
                No votes were recorded for this session.
              </p>
            ) : (
              <div className="collab-results-chart">
                {rankedVoteRows.map(({ attraction, result }) => {
                  const barWidthPct = (result.yesVotes / maxYesVotes) * 100;
                  return (
                    <article key={attraction.id} className="collab-results-row">
                      <div className="collab-results-row-head">
                        <div>
                          <strong>{attraction.name}</strong>
                          <p>{formatLocation(attraction.city, attraction.country)}</p>
                        </div>
                        <span className="collab-results-row-score">
                          👍 {result.yesVotes}
                        </span>
                      </div>
                      <div className="collab-results-bar collab-results-bar-single">
                        <div
                          className="collab-results-bar-fill"
                          style={{ width: `${barWidthPct}%` }}
                          title={`Thumbs up: ${result.yesVotes}`}
                        />
                      </div>
                      <p className="collab-results-row-meta">
                        👍 {result.yesVotes} · 👎 {result.noVotes} · {result.yesVotes > result.noVotes ? "Included" : "Excluded"}
                      </p>
                    </article>
                  );
                })}
              </div>
            )}

            {itineraryPath && (
              <div style={{ marginTop: 16, textAlign: "center" }}>
                <button
                  type="button"
                  className="saved-trips-button saved-trips-button-primary"
                  onClick={() => router.push(itineraryPath)}
                >
                  View itinerary
                </button>
              </div>
            )}
          </section>
        )}

        {!isLoading && !error && !isSessionExpired && currentAttraction && (viewMode === 'cardsFocused' || !decks) && (
          <section className="about-card" style={{ maxWidth: 980, marginLeft: "auto", marginRight: "auto" }}>
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

            <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
              {!allAttractionsVoted && !isSessionExpired && (
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

              {!allAttractionsVoted && !isSessionExpired && (
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
                Card {currentIndex + 1} of {displayedAttractions.length}
              </p>
              <button
                type="button"
                className="saved-trips-button"
                onClick={() => setCurrentIndex((index) => Math.min(displayedAttractions.length - 1, index + 1))}
                disabled={currentIndex >= displayedAttractions.length - 1}
              >
                Next
              </button>
            </div>
          </section>
        )}
        </div>
        {!isLoading && !error && isSessionExpired && itineraryPath && (
          <aside
            className="about-card"
            style={{
              flex: "0 0 220px",
              position: "sticky",
              top: 88,
              padding: 20
            }}
          >
            <h2 style={{ margin: "0 0 8px", fontSize: "1.1rem" }}>Session ended</h2>
            <p style={{ margin: "0 0 16px", fontSize: "0.9rem", color: "#52606d" }}>
              View your itinerary with the top-voted places.
            </p>
            <button
              type="button"
              className="saved-trips-button saved-trips-button-primary"
              style={{ width: "100%" }}
              onClick={() => router.push(itineraryPath)}
            >
              View itinerary →
            </button>
          </aside>
        )}
      </section>
    </main>
  );
}
