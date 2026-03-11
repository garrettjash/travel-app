import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";
import { useAuth } from "../lib/auth-context";

type FilterOptionsResponse = {
  options?: Array<{
    id: number;
    label: string;
  }>;
  error?: string;
};

type ChatMessage = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
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

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";

  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const messageDayStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const dayDifference = Math.round(
    (todayStart.getTime() - messageDayStart.getTime()) / (1000 * 60 * 60 * 24)
  );

  const dayLabel =
    dayDifference === 0
      ? "Today"
      : dayDifference === 1
        ? "Yesterday"
        : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });

  const timeLabel = date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit"
  });

  return `${dayLabel}, ${timeLabel}`;
}

function renderFormattedMessage(content: string): ReactNode {
  const boldPattern = /\*\*(.+?)\*\*/g;
  const parts: ReactNode[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(content)) !== null) {
    if (match.index > cursor) {
      parts.push(content.slice(cursor, match.index));
    }
    parts.push(<strong key={`bold-${match.index}`}>{match[1]}</strong>);
    cursor = match.index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }

  return parts.length > 0 ? parts : content;
}

export default function CollabPlannerPage() {
  const router = useRouter();
  const { user } = useAuth();
  const placeQuery = router.query.place;
  const chatQuery = router.query.chat;
  const initialPlace = sanitizePlainText(Array.isArray(placeQuery) ? placeQuery[0] ?? "" : placeQuery ?? "");

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
  const [isChatOpen, setIsChatOpen] = useState(false);
  const [isCollaborateCollapsed, setIsCollaborateCollapsed] = useState(false);

  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(0);

  const canSend = useMemo(() => draft.trim().length > 0 && !isSending, [draft, isSending]);

  useEffect(() => {
    if (isChatOpen) return;
    setIsCollaborateCollapsed(false);
  }, [isChatOpen]);

  useEffect(() => {
    if (!router.isReady) return;
    const chatMode = Array.isArray(chatQuery) ? chatQuery[0] : chatQuery;
    setIsChatOpen(chatMode === "open");
  }, [chatQuery, router.isReady]);

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
        if (isActive) setIsLoadingPlaces(false);
      }
    }

    loadPlaces();

    return () => {
      isActive = false;
    };
  }, []);

  useEffect(() => {
    if (!initialPlace || places.length === 0) return;
    const normalized = initialPlace.toLowerCase();
    const matched =
      places.find((place) => place.label.toLowerCase() === normalized) ??
      places.find((place) => place.label.toLowerCase().startsWith(normalized)) ??
      places.find((place) => place.label.toLowerCase().includes(normalized));

    if (matched) {
      setPlaceInput(matched.label);
      setSelectedPlaceId(matched.id);
      setPlaceError(null);
      return;
    }

    setPlaceInput(initialPlace);
  }, [initialPlace, places]);

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

  const fetchMessages = async (activeSessionId: string) => {
    try {
      const params = new URLSearchParams({
        session_id: activeSessionId,
        limit: "100"
      });
      const res = await fetch(`/api/chat-messages?${params.toString()}`);
      const data = await res.json();

      if (!res.ok) throw new Error(data.error || "Failed to fetch messages");

      const mapped: ChatMessage[] = (data.data ?? []).map((msg: any) => ({
        message_id: String(msg.message_id),
        role: msg.role === "assistant" ? "assistant" : "user",
        content: msg.content,
        createdAt: msg.created_at ?? new Date().toISOString()
      }));

      setMessages(mapped);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Unknown error fetching messages");
    }
  };

  useEffect(() => {
    setMessages([]);
    setChatError(null);
    setSessionId(crypto.randomUUID());
  }, []);

  useEffect(() => {
    if (!sessionId) return;
    fetchMessages(sessionId);
  }, [sessionId]);

  useEffect(() => {
    const previousCount = previousMessageCountRef.current;
    const hasNewMessage = messages.length > previousCount;
    const latestMessage = messages[messages.length - 1];

    if (hasNewMessage && latestMessage) {
      if (latestMessage.role === "assistant") {
        const assistantMessage = document.getElementById(`chat-message-${latestMessage.message_id}`);
        assistantMessage?.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      }
    }

    previousMessageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    if (!initialPlace || !sessionId) return;
    setDraft(`Help me plan a group trip to ${initialPlace}. What are the best things to do?`);
  }, [initialPlace, sessionId]);

  const handleChatSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending || !sessionId) return;

    setIsSending(true);
    setDraft("");
    setChatError(null);

    const userMessage: ChatMessage = {
      message_id: crypto.randomUUID(),
      role: "user",
      content,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const agentResponse = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: content, session_id: sessionId, user_id: user?.id ?? undefined })
      });

      const agentData = await agentResponse.json();
      if (!agentResponse.ok) throw new Error(agentData.error || "Failed to send message");

      const agentMessage: ChatMessage = {
        message_id: String(agentData.message_id ?? crypto.randomUUID()),
        role: "assistant",
        content: agentData.output,
        createdAt: agentData.createdAt ?? new Date().toISOString()
      };
      setMessages((prev) => [...prev, agentMessage]);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main
      className={`collab-planner-page ${isChatOpen ? "collab-planner-page-chat-open" : ""} ${
        isCollaborateCollapsed ? "collab-planner-page-main-collapsed" : ""
      }`}
    >
      <header className="collab-planner-topbar">
        <button type="button" className="solo-back-button" onClick={() => router.push("/planning-options")}>
          ← Back
        </button>
        <AuthButton />
      </header>

      <section className="collab-planner-main">
        <div className="collab-planner-content planner-pane-surface">
          <div className="planner-pane-header collab-planner-pane-header">
            <div>
              <h1>Collaborate</h1>
              <p>Create or join a collaborate session.</p>
            </div>
          </div>
          <button
            type="button"
            className="planner-pane-side-toggle planner-pane-side-toggle-right"
            onClick={() => {
              if (isChatOpen) {
                setIsCollaborateCollapsed((collapsed) => !collapsed);
                return;
              }
              setIsChatOpen(true);
            }}
            aria-label={
              isChatOpen
                ? isCollaborateCollapsed
                  ? "Expand collaborate panel"
                  : "Collapse collaborate panel"
                : "Open AI chatbot panel"
            }
            title={
              isChatOpen
                ? isCollaborateCollapsed
                  ? "Expand collaborate panel"
                  : "Collapse collaborate panel"
                : "Open chat"
            }
          >
            <span aria-hidden="true">{isChatOpen ? (isCollaborateCollapsed ? "→" : "←") : "←"}</span>
          </button>
          <section className="about-card">
            <h2>Start a session</h2>
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
                  {isCreatingSession ? "Creating..." : "Create!"}
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

      <aside className={`collab-chat-panel ${isChatOpen ? "collab-chat-panel-open" : ""}`}>
        <section className="chat-shell collab-chat-shell planner-pane-surface">
          <header className="chat-header planner-pane-header">
            <div>
              <h1>AI Travel Chatbot</h1>
              <p>{initialPlace ? `Group planning for ${initialPlace}.` : "Use AI while you set up your group session."}</p>
            </div>
          </header>
          <button
            type="button"
            className="planner-pane-side-toggle planner-pane-side-toggle-left"
            onClick={() => setIsChatOpen(false)}
            aria-label="Collapse chatbot panel"
            title="Collapse chatbot"
          >
            <span aria-hidden="true">→</span>
          </button>

          <div className="chat-messages" role="log" aria-live="polite">
            {messages.length === 0 && <p className="chat-state">No messages yet.</p>}
            {messages.map((msg) => (
              <article
                className={`chat-message ${msg.role === "assistant" ? "chat-message-assistant" : "chat-message-user"}`}
                key={msg.message_id}
                id={`chat-message-${msg.message_id}`}
              >
                <div className="chat-message-meta">
                  <strong>{msg.role === "user" ? "Me" : "Assistant"}</strong>
                  <span>{formatTimestamp(msg.createdAt)}</span>
                </div>
                <p>{renderFormattedMessage(msg.content)}</p>
              </article>
            ))}
            {isSending && (
              <article className="chat-message chat-message-assistant chat-message-typing">
                <div className="chat-message-meta">
                  <strong>Assistant</strong>
                </div>
                <div className="chat-typing-dots" aria-label="Assistant is typing">
                  <span />
                  <span />
                  <span />
                </div>
              </article>
            )}
            <div ref={messagesEndRef} />
          </div>

          <form className="chat-form" onSubmit={handleChatSubmit}>
            <label htmlFor="collab-chat-input" className="chat-form-label">
              Message
            </label>
            <div className="chat-form-row">
              <input
                id="collab-chat-input"
                className="chat-input"
                type="text"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="Type your message..."
                maxLength={2000}
              />
              <button type="submit" disabled={!canSend} className="chat-send-button">
                {isSending ? <span className="chat-send-spinner" aria-label="Sending message" /> : "Send"}
              </button>
            </div>
            {chatError && <p className="chat-error">{chatError}</p>}
          </form>
        </section>
      </aside>
    </main>
  );
}
