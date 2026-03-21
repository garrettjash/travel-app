import { FormEvent, KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "../../components/AuthButton";
import AppTopNav from "../../components/AppTopNav";
import ChatMessageContent from "../../components/ChatMessageContent";
import SavedTripBuilder, {
  SavedItinerary,
  type SavedTripBuilderHandle
} from "../../components/SavedTripBuilder";
import { FavoriteAttraction } from "../../lib/favorites-context";
import { useAuth } from "../../lib/auth-context";
import { useItinerary } from "../../lib/itinerary-context";

type ChatMessage = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

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

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

export default function SoloPlannerItineraryPage() {
  const { user } = useAuth();
  const router = useRouter();
  const { itineraryId } = router.query;
  const placeQuery = router.query.place;
  const initialPlace = Array.isArray(placeQuery) ? placeQuery[0] : placeQuery;

  const { attractions, addAttraction, removeAttraction, clearAttractions, isInItinerary } =
    useItinerary();

  const [isChatOpen, setIsChatOpen] = useState(false);
  const [suggestedAttractions, setSuggestedAttractions] = useState<FavoriteAttraction[]>([]);
  const [isLoadingSuggested, setIsLoadingSuggested] = useState(false);

  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(0);
  const draftInputRef = useRef<HTMLTextAreaElement | null>(null);
  const builderRef = useRef<SavedTripBuilderHandle | null>(null);

  const [refreshedItinerary, setRefreshedItinerary] = useState<SavedItinerary | null>(null);
  const [itineraryRefreshVersion, setItineraryRefreshVersion] = useState(0);

  const canSend = useMemo(() => draft.trim().length > 0 && !isSending, [draft, isSending]);

  const itineraryIdFromRoute = Array.isArray(itineraryId) ? itineraryId[0] : itineraryId;

  const collabSessionFromUrl = useMemo(() => {
    const raw = router.query.collabSession;
    return typeof raw === "string" ? raw.trim() : Array.isArray(raw) ? (raw[0] ?? "").trim() : "";
  }, [router.query.collabSession]);

  const fetchItinerary = useCallback(async () => {
    if (!itineraryIdFromRoute) return null;
    try {
      const params = new URLSearchParams({ itineraryId: itineraryIdFromRoute });
      if (user?.id) params.set("userId", user.id);
      if (collabSessionFromUrl) params.set("collabSession", collabSessionFromUrl);
      const res = await fetch(`/api/itinerary?${params.toString()}`);
      const data = (await res.json()) as { itinerary?: SavedItinerary; error?: string };
      if (res.ok && data.itinerary) {
        console.log("[solo-planner] fetchItinerary received", {
          itineraryId: data.itinerary.itineraryId,
          unscheduledCount: data.itinerary.unscheduled?.length ?? 0,
          daysCount: data.itinerary.days?.length ?? 0
        });
        return data.itinerary;
      }
    } catch {
      /* ignore */
    }
    return null;
  }, [itineraryIdFromRoute, user?.id, collabSessionFromUrl]);

  // Load existing itinerary for this ID (e.g. from My Itineraries or collab)
  useEffect(() => {
    let cancelled = false;
    if (!itineraryIdFromRoute) return;

    (async () => {
      const existing = await fetchItinerary();
      if (!cancelled && existing) {
        setRefreshedItinerary(existing);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fetchItinerary, itineraryIdFromRoute]);

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
        const assistantMessage = document.getElementById(
          `chat-message-${latestMessage.message_id}`
        );
        assistantMessage?.scrollIntoView({ block: "start", behavior: "smooth" });
      } else {
        messagesEndRef.current?.scrollIntoView({ block: "end", behavior: "smooth" });
      }
    }

    previousMessageCountRef.current = messages.length;
  }, [messages]);

  useEffect(() => {
    const element = draftInputRef.current;
    if (!element) return;
    element.style.height = "0px";
    element.style.height = `${Math.min(element.scrollHeight, 180)}px`;
  }, [draft]);

  const handleDraftKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  useEffect(() => {
    if (!initialPlace || !sessionId) return;
    setDraft(`Show me the best things to do in ${initialPlace}`);
  }, [initialPlace, sessionId]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending || !sessionId) return;

    setIsSending(true);
    setDraft("");
    setChatError(null);

    try {
      if (builderRef.current?.hasBeenSaved) {
        await builderRef.current.save();
      }
    } catch {
      /* save errors surfaced in builder */
    }

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
        body: JSON.stringify({
          prompt: content,
          session_id: sessionId,
          user_id: user?.id ?? undefined,
          itinerary_id: itineraryIdFromRoute ?? undefined
        })
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

      const shouldRefresh =
        Boolean(agentData.itinerary_modified) || Boolean(agentData.refresh_data);
      if (shouldRefresh && itineraryIdFromRoute) {
        const fresh = await fetchItinerary();
        if (fresh) {
          setRefreshedItinerary(fresh);
          setItineraryRefreshVersion((v) => v + 1);
        }
      }
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main
      className={`solo-planner-page ${isChatOpen ? "solo-planner-page-chat-open" : ""} ${
        isSending ? "solo-planner-page-chat-busy" : ""
      }`}
    >
      <header className="destinations-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <AppTopNav activeTab="solo-planner" />
        <div className="destinations-topbar-actions">
          <AuthButton />
        </div>
      </header>

      <section className="solo-planner-main">
        <aside className="solo-itinerary-panel solo-itinerary-panel-open">
          <div className="solo-itinerary-panel-inner planner-pane-surface">
            {initialPlace && (
              <section className="solo-itinerary-suggested">
                <h3>Suggested for {initialPlace}</h3>
                {isLoadingSuggested ? (
                  <p className="saved-suggested-loading">Loading suggestions...</p>
                ) : (
                  <div className="solo-itinerary-list">
                    {suggestedAttractions.slice(0, 8).map((attraction) => {
                      const added = isInItinerary(attraction.id);
                      return (
                        <article className="solo-itinerary-item" key={attraction.id}>
                          <div>
                            <strong>{attraction.name}</strong>
                            <p>
                              {formatLocation(
                                attraction.city,
                                attraction.stateProvince,
                                attraction.country
                              )}
                            </p>
                          </div>
                          <button
                            type="button"
                            className={`saved-suggested-add ${added ? "saved-suggested-added" : ""}`}
                            onClick={() =>
                              added ? removeAttraction(attraction.id) : addAttraction(attraction)
                            }
                          >
                            {added ? "Added" : "+ Add"}
                          </button>
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            )}

            <SavedTripBuilder
              ref={builderRef}
              embedded
              initialItinerary={refreshedItinerary ?? undefined}
              initialTripPlace={typeof initialPlace === "string" ? initialPlace : undefined}
              itineraryIdFromRoute={String(itineraryIdFromRoute ?? "")}
              key={
                refreshedItinerary
                  ? `refresh-${itineraryRefreshVersion}-${refreshedItinerary.itineraryId}`
                  : "new"
              }
            />
          </div>
        </aside>
      </section>

      <aside className={`solo-chat-panel ${isChatOpen ? "solo-chat-panel-open" : ""}`}>
        <section className="chat-shell solo-chat-shell planner-pane-surface">
          <header className="chat-header planner-pane-header">
            <div>
              <h1>AI Travel Chatbot</h1>
              <p>
                {initialPlace
                  ? `Planning for ${initialPlace}.`
                  : "Ask where to go, what to do, and how to organize your trip."}
              </p>
            </div>
            <button
              type="button"
              className="planner-pane-close-button"
              onClick={() => setIsChatOpen(false)}
              aria-label="Close AI chat"
              title="Close AI chat"
            >
              ×
            </button>
          </header>

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
                <ChatMessageContent content={msg.content} />
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

          <form className="chat-form" onSubmit={handleSubmit}>
            <label htmlFor="solo-chat-input" className="chat-form-label">
              Message
            </label>
            <div className="chat-form-row">
              <textarea
                ref={draftInputRef}
                id="solo-chat-input"
                className="chat-input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={handleDraftKeyDown}
                placeholder="Type your message..."
                maxLength={2000}
                rows={1}
              />
              <button type="submit" disabled={!canSend} className="chat-send-button">
                {isSending ? (
                  <span className="chat-send-spinner" aria-label="Sending message" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
            {chatError && <p className="chat-error">{chatError}</p>}
          </form>
        </section>
      </aside>

      <button
        type="button"
        className="solo-chat-fab"
        onClick={() => setIsChatOpen((previous) => !previous)}
        aria-label={isChatOpen ? "Close AI chat" : "Open AI chat"}
        title={isChatOpen ? "Close AI chat" : "Open AI chat"}
      >
        <img src="/chat-icon.svg" alt="" width={24} height={24} aria-hidden="true" />
      </button>
    </main>
  );
}
