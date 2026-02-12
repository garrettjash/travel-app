import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AttractionsExplorer from "../components/AttractionsExplorer";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
}

function extractAssistantText(rawResponse: string) {
  try {
    const parsed = JSON.parse(rawResponse) as Record<string, unknown>;
    const payload =
      parsed && typeof parsed.data === "object" && parsed.data !== null
        ? (parsed.data as Record<string, unknown>)
        : parsed;
    if (typeof payload.response === "string") return payload.response;
    if (typeof payload.answer === "string") return payload.answer;
    if (typeof payload.output === "string") return payload.output;
    if (typeof payload.message === "string") return payload.message;
    if (typeof payload.body === "string") return payload.body;
    if (typeof parsed.data === "string") return parsed.data;
    return JSON.stringify(parsed, null, 2);
  } catch {
    return rawResponse;
  }
}

export default function AiChatbotPage() {
  const router = useRouter();
  const sessionId = "57076c76-ad4c-4124-8a80-f4c151366844";
  const isChatView = router.query.view === "chat";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(
    () => draft.trim().length > 0 && !isSending,
    [draft, isSending]
  );

  const fetchMessages = async () => {
    try {
      const res = await fetch("/api/chat-messages");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to fetch messages");

      const mapped: ChatMessage[] = (data.data ?? []).map((msg: any) => ({
        id: msg.message_id.toString(),
        role: msg.sender === "assistant" ? "assistant" : "user",
        content: msg.content,
        createdAt: msg.created_at ?? new Date().toISOString()
      }));

      setMessages(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error fetching messages");
    }
  };

  useEffect(() => {
    if (!isChatView) return;
    fetchMessages();
  }, [isChatView]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending) return;

    setIsSending(true);
    setDraft("");
    setError(null);

    try {
      const agentResponse = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: content, session_id: sessionId })
      });

      const agentRawResponse = await agentResponse.text();
      if (!agentResponse.ok) {
        let errorMessage = agentRawResponse;
        try {
          const parsed = JSON.parse(agentRawResponse);
          if (parsed.error) errorMessage = parsed.error;
        } catch {}
        throw new Error(errorMessage);
      }

      await fetch("/api/chat-messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: extractAssistantText(agentRawResponse),
          sender: "assistant"
        })
      });

      await fetchMessages();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send message");
    } finally {
      setIsSending(false);
    }
  };

  if (!isChatView) {
    return (
      <main className="destinations-page">
        <header className="destinations-topbar">
          <span className="destinations-brand">TravelApp</span>
          <button type="button" className="destinations-login">Login</button>
        </header>

        <section className="destinations-layout">
          <nav className="destinations-sidebar" aria-label="Main navigation">
            <button type="button" className="destinations-tab">
              <span aria-hidden="true">🛏️</span>
              <span>Stays</span>
            </button>
            <button type="button" className="destinations-tab">
              <span aria-hidden="true">✈️</span>
              <span>Flights</span>
            </button>
            <button type="button" className="destinations-tab destinations-tab-active">
              <span aria-hidden="true">🗺️</span>
              <span>Destinations</span>
            </button>
            <button type="button" className="destinations-tab">
              <span aria-hidden="true">💾</span>
              <span>Saved Trips</span>
            </button>
            <button
              type="button"
              className="destinations-tab"
              onClick={() => router.push("/ai-chatbot?view=chat")}
            >
              <span aria-hidden="true">✨</span>
              <span>AI Chatbot</span>
            </button>
          </nav>

          <div className="destinations-content">
            <AttractionsExplorer
              title="Top Choices For Your Selections"
              subtitle="Explore attractions based on your filters."
            />
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="chat-page">
      <section className="chat-shell">
        <header className="chat-header">
          <button type="button" className="chat-back-button" onClick={() => router.back()}>
            ← Back
          </button>
          <h1>AI Travel Chatbot</h1>
          <p>Ask travel questions and view the conversation from your database.</p>
        </header>

        <div className="chat-messages" role="log" aria-live="polite">
          {messages.length === 0 && <p className="chat-state">No messages yet.</p>}
          {messages.map((msg) => (
            <article className="chat-message" key={msg.id}>
              <div className="chat-message-meta">
                <strong>{msg.role}</strong>
                <span>{formatTimestamp(msg.createdAt)}</span>
              </div>
              <p>{msg.content}</p>
            </article>
          ))}
        </div>

        <form className="chat-form" onSubmit={handleSubmit}>
          <label htmlFor="chat-input" className="chat-form-label">
            Message
          </label>
          <div className="chat-form-row">
            <input
              id="chat-input"
              className="chat-input"
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Type your message..."
              maxLength={2000}
            />
            <button type="submit" disabled={!canSend} className="chat-send-button">
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
          {error && <p className="chat-error">{error}</p>}
        </form>
      </section>
    </main>
  );
}
