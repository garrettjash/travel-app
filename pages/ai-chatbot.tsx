import { FormEvent, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AttractionsExplorer from "../components/AttractionsExplorer";

type ChatMessage = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Unknown time";
  return date.toLocaleString();
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
        message_id: String(msg.message_id),
        role: msg.role === "assistant" ? "assistant" : "user",
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

    const userMessage: ChatMessage = {
      message_id: crypto.randomUUID(),
      role: "user",
      content: content,
      createdAt: new Date().toISOString()
    };
    setMessages((prev) => [...prev, userMessage]);

    try {
      const agentResponse = await fetch("/api/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: content, session_id: sessionId })
      });

      const agentData = await agentResponse.json();
      console.log("Agent response:", agentData);

      if (!agentResponse.ok) {
        throw new Error(agentData.error || "Failed to send message");
      }

      const agentMessage: ChatMessage = {
        message_id: String(agentData.message_id ?? crypto.randomUUID()),
        role: "assistant",
        content: agentData.output,
        createdAt: agentData.createdAt ?? new Date().toISOString()
      };
      setMessages((prev) => [...prev, agentMessage]);
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
            <article
              className={`chat-message ${
                msg.role === "assistant" ? "chat-message-assistant" : "chat-message-user"
              }`}
              key={msg.message_id}
            >
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
