import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import PlaceSearchInput from "../components/PlaceSearchInput";
import { useAuth } from "../lib/auth-context";
import QRCode from "qrcode";

type FilterOptionsResponse = {
  options?: Array<{
    id: number;
    label: string;
  }>;
  error?: string;
};

const LINK_DURATION_OPTIONS = [
  { label: "1 Minute", minutes: 1 },
  { label: "5 minutes", minutes: 5 },
  { label: "10 minutes", minutes: 10 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "2 hours", minutes: 120 },
  { label: "5 hours", minutes: 300 },
  { label: "12 hours", minutes: 720 },
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
  const { user } = useAuth();
  const [placeError, setPlaceError] = useState<string | null>(null);

  const [placeEntries, setPlaceEntries] = useState<Array<{ value: string; selected?: { id: number; label: string } }>>([
    { value: "" }
  ]);
  const [selectedDurationMinutes, setSelectedDurationMinutes] = useState<number>(60);
  const [createSessionLink, setCreateSessionLink] = useState<string | null>(null);
  const [createSessionError, setCreateSessionError] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isLinkCopied, setIsLinkCopied] = useState(false);
  const [joinLinkInput, setJoinLinkInput] = useState("");
  const [joinLinkError, setJoinLinkError] = useState<string | null>(null);
  const [isDownloadingQr, setIsDownloadingQr] = useState(false);
  const [createSessionId, setCreateSessionId] = useState<string | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);

  const filteredPlaces = useMemo(() => [], []);

  const canCreateSession = placeEntries.some((e) => e.selected && e.selected.id);
  const canAttemptJoin = sanitizeUrlInput(joinLinkInput).length > 0;

  function handlePlaceInputChange(value: string, index = 0) {
    const safeValue = value; // allow spaces and user text; PlaceSearchInput will handle trimming
    setPlaceEntries((arr) => arr.map((v, i) => (i === index ? { ...v, value: safeValue } : v)));
    setCreateSessionLink(null);
    setCreateSessionError(null);
    setIsLinkCopied(false);
    setPlaceError(null);
  }

  function handlePlaceSelect(place: { id: number; label: string }, index: number) {
    // Prevent selecting the same place in more than one input
    const duplicate = placeEntries.some((e, i) => i !== index && e.selected?.id === place.id);
    if (duplicate) {
      setPlaceError("This destination is already selected.");
      return;
    }

    setPlaceEntries((arr) => arr.map((v, i) => (i === index ? { value: place.label, selected: { id: place.id, label: place.label } } : v)));
    setCreateSessionLink(null);
    setCreateSessionError(null);
    setIsLinkCopied(false);
    setPlaceError(null);
  }

  function removeInput(index: number) {
    setPlaceEntries((arr) => arr.filter((_, i) => i !== index));
    setCreateSessionLink(null);
    setCreateSessionError(null);
    setIsLinkCopied(false);
  }

  async function handleCreateSessionClick() {
    const placeIds = placeEntries.map((e) => e.selected?.id).filter((id): id is number => Boolean(id));
    if (placeIds.length === 0) {
      setPlaceError("Choose at least one destination from the dropdowns.");
      return;
    }
    if (!user) {
      setCreateSessionError("You must be logged in to create a session.");
      return;
    }

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
          placeIds,
          durationMinutes: selectedDurationMinutes,
          userId: user.id
        })
      });

      const payload = (await response.json()) as { sessionPath?: string; error?: string };

      if (!response.ok || !payload.sessionPath) {
        throw new Error(payload.error || "Failed to create collab session.");
      }

      const fullSessionLink = `${window.location.origin}${payload.sessionPath}`;
      setCreateSessionLink(fullSessionLink);
      setCreateSessionId(token);
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

  useEffect(() => {
    let canceled = false;
    async function gen() {
      if (!createSessionLink) {
        setQrDataUrl(null);
        return;
      }

      try {
        // Prefer using the imported QRCode, but dynamically import as a fallback
        let qlib: any = QRCode;
        if (!qlib || typeof qlib.toDataURL !== "function") {
          try {
            const mod = await import("qrcode");
            qlib = mod && (mod.default || mod);
          } catch (err) {
            console.error("Failed to dynamically import qrcode:", err);
            qlib = null;
          }
        }

        if (!qlib || typeof qlib.toDataURL !== "function") {
          console.error("QRCode library not available or missing toDataURL");
          if (!canceled) setQrDataUrl(null);
          return;
        }

        const dataUrl = await qlib.toDataURL(createSessionLink, { width: 300 });
        if (!canceled) {
          setQrDataUrl(dataUrl);
          console.debug("Generated QR data URL for session", createSessionId);
        }
      } catch (err) {
        console.error("Error generating QR code:", err);
        if (!canceled) setQrDataUrl(null);
      }
    }

    gen();
    return () => {
      canceled = true;
    };
  }, [createSessionLink, createSessionId]);

  async function handleDownloadQr() {
    if (!qrDataUrl || !createSessionId) return;
    setIsDownloadingQr(true);
    try {
      const a = document.createElement("a");
      a.href = qrDataUrl;
      a.download = `travelapp_qr_collab_${createSessionId}.png`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      // ignore
    } finally {
      setIsDownloadingQr(false);
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
    <AppShell activeTab="collaborate">
      <div className="collaborate-page-content">
        <section className="about-card">
          <h1>Collaborate</h1>
          <p>Create or join a collaborate session.</p>
        </section>

        <section className="about-card">
          <div className="saved-trips-builder" style={{ marginTop: 14, gridTemplateColumns: "1fr" }}>
            <div className="saved-trips-field">
              <label htmlFor="collab-place-search">CREATE A COLLAB SESSION</label>
              <div style={{ display: "flex", gap: 8, flexDirection: "column" }}>
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {placeEntries.map((entry, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <PlaceSearchInput
                        id={`collab-place-search-${idx}`}
                        value={entry.value}
                        onChange={(v) => handlePlaceInputChange(v, idx)}
                        onSelect={(p) => handlePlaceSelect({ id: p.id, label: p.label }, idx)}
                        placeholder={"Type to search destinations…"}
                        className="planning-solo-input"
                        aria-label={`Add a place (${idx + 1})`}
                      />
                      <button
                        type="button"
                        className="remove-input-button"
                        onClick={() => removeInput(idx)}
                        aria-label={`Remove place ${idx + 1}`}
                        title={placeEntries.length > 1 ? "Remove this place" : "Remove this place"}
                      >
                        −
                      </button>
                    </div>
                  ))}

                  <button
                    type="button"
                    className="saved-trips-button"
                    onClick={() => setPlaceEntries((s) => [...s, { value: "" }])}
                  >
                    Add another place
                  </button>
                </div>
              </div>
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

            <div className="saved-trips-actions" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className={`saved-trips-button ${canCreateSession && user ? "saved-trips-button-primary" : "saved-trips-button-muted"}`}
                onClick={handleCreateSessionClick}
                disabled={!canCreateSession || isCreatingSession || !user}
              >
                {isCreatingSession ? "Creating..." : "Create!"}
              </button>
              {!user && (
                <span style={{ color: "#666", fontSize: 13 }}>
                  Create sessions requires logging in
                </span>
              )}
            </div>
          </div>

          {placeError && <p className="attractions-state">{placeError}</p>}
          {createSessionError && <p className="attractions-state attractions-state-error">{createSessionError}</p>}
          {createSessionLink && (
            <div style={{ marginTop: 8 }}>
              <div className="saved-trips-actions" style={{ alignItems: "center" }}>
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

              <div className="saved-trips-actions" style={{ marginTop: 8, alignItems: "center", gap: 12 }}>
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR code for session link"
                    style={{ width: 100, height: 100, border: "1px solid #e6e6e6", borderRadius: 6 }}
                  />
                )}

                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    type="button"
                    className="saved-trips-button"
                    onClick={handleDownloadQr}
                    disabled={!qrDataUrl || isDownloadingQr}
                  >
                    {isDownloadingQr ? "Downloading..." : "Download QR Code"}
                  </button>
                </div>
              </div>
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
    </AppShell>
  );
}
