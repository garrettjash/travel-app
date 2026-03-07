import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";

type FilterOptionsResponse = {
  options?: Array<{
    id: number;
    label: string;
  }>;
  error?: string;
};

const LINK_DURATION_OPTIONS = [
  { label: "5m", minutes: 5 },
  { label: "10m", minutes: 10 },
  { label: "15m", minutes: 15 },
  { label: "30m", minutes: 30 },
  { label: "1 hr", minutes: 60 },
  { label: "2 hr", minutes: 120 },
  { label: "5 hr", minutes: 300 },
  { label: "12 hr", minutes: 720 },
  { label: "1 day", minutes: 1440 }
] as const;

function sanitizePlainText(rawValue: string) {
  return rawValue
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .replace(/[^\p{L}\p{N}\s,.'()\-]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function sanitizeUrlInput(rawValue: string) {
  return rawValue
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F]/g, "")
    .trim()
    .slice(0, 2048);
}

function getSafeCollabUrl(inputValue: string) {
  if (!inputValue) return null;
  if (/(javascript|data|vbscript|file)\s*:/i.test(inputValue)) return null;

  try {
    const parsed = new URL(inputValue, window.location.origin);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.origin !== window.location.origin) return null;
    if (!parsed.pathname.toLowerCase().startsWith("/collaborate")) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

export default function CollaboratePage() {
  const router = useRouter();
  const [places, setPlaces] = useState<Array<{ id: number; label: string }>>([]);
  const [isLoadingPlaces, setIsLoadingPlaces] = useState(true);
  const [placeError, setPlaceError] = useState<string | null>(null);
  const [placeInput, setPlaceInput] = useState("");
  const [selectedPlaceId, setSelectedPlaceId] = useState<number | null>(null);
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number>(60);
  const [createSessionLink, setCreateSessionLink] = useState<string | null>(null);
  const [createSessionError, setCreateSessionError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [joinLinkInput, setJoinLinkInput] = useState("");
  const [joinLinkError, setJoinLinkError] = useState<string | null>(null);

  useEffect(() => {
    let isActive = true;

    async function loadPlaces() {
      setIsLoadingPlaces(true);
      setPlaceError(null);

      try {
        const response = await fetch("/api/collab-places", {
          method: "GET",
          headers: {
            Accept: "application/json"
          }
        });
        const payload = (await response.json()) as FilterOptionsResponse;

        if (!isActive) return;

        if (!response.ok || payload.error) {
          throw new Error(payload.error || "Unable to load places");
        }

        const safePlaces = (payload.options ?? [])
          .map((option) => {
            const id = Number(option.id);
            const label = sanitizePlainText(option.label);
            if (!Number.isFinite(id) || !label) return null;
            return { id, label };
          })
          .filter((option): option is { id: number; label: string } => Boolean(option));

        setPlaces(safePlaces);
      } catch (error) {
        if (!isActive) return;
        setPlaces([]);
        setPlaceError(error instanceof Error ? error.message : "Unknown error loading places");
      } finally {
        if (isActive) {
          setIsLoadingPlaces(false);
        }
      }
    }

    loadPlaces();

    return () => {
      isActive = false;
    };
  }, []);

  const filteredPlaces = useMemo(() => {
    const query = sanitizePlainText(placeInput).toLowerCase();
    if (!query) return places.slice(0, 200);
    return places.filter((place) => place.label.toLowerCase().includes(query)).slice(0, 200);
  }, [placeInput, places]);

  const canCreateSession = selectedPlaceId !== null;
  const canAttemptJoin = sanitizeUrlInput(joinLinkInput).length > 0;

  function handlePlaceInputChange(value: string) {
    const safeValue = sanitizePlainText(value);
    setPlaceInput(safeValue);
    setCreateSessionLink(null);
    setCreateSessionError(null);
    setIsLinkCopied(false);

    const selectedOption = places.find((place) => place.label === safeValue);
    if (selectedOption) {
      setSelectedPlaceId(selectedOption.id);
      setPlaceError(null);
      return;
    }

    setSelectedPlaceId(null);
    if (safeValue) {
      setPlaceError("Choose a place from the list.");
    } else {
      setPlaceError(null);
    }
  }

  async function handleCreateSessionClick() {
    if (selectedPlaceId === null) return;

    setIsCreatingSession(true);
    setCreateSessionError(null);

    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

    try {
      const response = await fetch("/api/collab-session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          sessionId: token,
          placeId: selectedPlaceId,
          durationMinutes: selectedDurationMinutes
        })
      });

      const payload = (await response.json()) as { sessionPath?: string; error?: string };

      if (!response.ok || !payload.sessionPath) {
        throw new Error(payload.error || "Failed to create collab session.");
      }

      const fullSessionLink = `${window.location.origin}${payload.sessionPath}`;
      setCreateSessionLink(fullSessionLink);
      setIsLinkCopied(false);
    } catch (error) {
      setCreateSessionLink(null);
      setCreateSessionError(error instanceof Error ? error.message : "Unknown error creating session");
    } finally {
      setIsCreatingSession(false);
    }
  }

  async function handleCopySessionLink() {
    if (!createSessionLink) return;

    try {
      await navigator.clipboard.writeText(createSessionLink);
      setIsLinkCopied(true);
    } catch {
      setIsLinkCopied(false);
    }
  }

  function handleJoinSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const sanitized = sanitizeUrlInput(joinLinkInput);
    const safePath = getSafeCollabUrl(sanitized);

    if (!safePath) {
      setJoinLinkError(
        "Enter a valid collaborate link on this site (http/https only)."
      );
      return;
    }

    setJoinLinkError(null);
    router.push(safePath);
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
          <button type="button" className="destinations-tab" onClick={() => router.push("/favorites")}>
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
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
            <h1>Collaborate</h1>
            <p>Create or join a collaborate session.</p>
          </section>

          <section className="about-card">
            <div className="saved-trips-builder" style={{ marginTop: 14, gridTemplateColumns: "1fr" }}>
              <div className="saved-trips-field">
                <label htmlFor="collab-place-search">CREATE A COLLAB SESSION</label>
                <input
                  id="collab-place-search"
                  type="text"
                  list="collab-place-options"
                  value={placeInput}
                  onChange={(event) => handlePlaceInputChange(event.target.value)}
                  placeholder={isLoadingPlaces ? "Loading places..." : "Search places in database"}
                  autoComplete="off"
                  inputMode="search"
                  disabled={isLoadingPlaces}
                />
                <datalist id="collab-place-options">
                  {filteredPlaces.map((place) => (
                    <option key={place.id} value={place.label} />
                  ))}
                </datalist>
              </div>

              <div className="saved-trips-field">
                <label htmlFor="collab-link-duration">Select how long the link should be live</label>
                <select
                  id="collab-link-duration"
                  value={selectedDurationMinutes}
                  onChange={(event) => {
                    const value = Number(event.target.value);
                    setSelectedDurationMinutes(Number.isFinite(value) ? value : 60);
                  }}
                >
                  {LINK_DURATION_OPTIONS.map((option) => (
                    <option key={option.minutes} value={option.minutes}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="saved-trips-actions">
                <button
                  type="button"
                  className={`saved-trips-button ${canCreateSession ? "saved-trips-button-primary" : "saved-trips-button-muted"}`}
                  onClick={handleCreateSessionClick}
                  disabled={!canCreateSession || isCreatingSession}
                >
                  {isCreatingSession ? "Creating..." : "Ceate!"}
                </button>
              </div>
            </div>

            {placeError && <p className="attractions-state">{placeError}</p>}
            {createSessionError && <p className="attractions-state attractions-state-error">{createSessionError}</p>}
            {createSessionLink && (
              <div className="saved-trips-actions" style={{ marginTop: 8 }}>
                <p className="attractions-state" style={{ margin: 0, flex: 1 }}>
                  Session link created: {createSessionLink}
                </p>
                <button
                  type="button"
                  className="saved-trips-button"
                  onClick={handleCopySessionLink}
                >
                  Copy
                </button>
              </div>
            )}
            {isLinkCopied && <p className="attractions-state">Link Copied!</p>}
          </section>

          <section className="about-card">
            <div className="saved-trips-field">
              <label htmlFor="collab-join-link">JOIN A COLLAB SESSION</label>
              <form onSubmit={handleJoinSubmit}>
                <div className="saved-trips-actions" style={{ marginTop: 0 }}>
                  <input
                    id="collab-join-link"
                    type="url"
                    value={joinLinkInput}
                    onChange={(event) => setJoinLinkInput(sanitizeUrlInput(event.target.value))}
                    placeholder="Paste a collaborate session link"
                    autoComplete="off"
                    spellCheck={false}
                  />
                  <button
                    type="submit"
                    className={`saved-trips-button ${canAttemptJoin ? "saved-trips-button-primary" : "saved-trips-button-muted"}`}
                    disabled={!canAttemptJoin}
                  >
                    Go!
                  </button>
                </div>
              </form>
            </div>

            {joinLinkError && <p className="attractions-state">{joinLinkError}</p>}
          </section>
        </div>
      </section>
    </main>
  );
}
