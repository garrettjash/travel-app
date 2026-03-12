import { FormEvent, ReactNode, useEffect, useMemo, useRef, useState } from "react";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/auth-context";

type ChatMessage = {
  message_id: string;
  role: "user" | "assistant";
  content: string;
  session_id?: string;
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

export default function AiChatbotPage() {
  const { user } = useAuth();

  const [sessionId, setSessionId] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const previousMessageCountRef = useRef(0);

  const canSend = useMemo(
    () => draft.trim().length > 0 && !isSending,
    [draft, isSending]
  );

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
        session_id: msg.session_id ? String(msg.session_id) : undefined,
        createdAt: msg.created_at ?? new Date().toISOString()
      }));

      setMessages(mapped);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error fetching messages");
    }
  };

  useEffect(() => {
    setMessages([]);
    setError(null);
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

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || isSending || !sessionId) return;

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
        body: JSON.stringify({ prompt: content, session_id: sessionId, user_id: user?.id ?? undefined })
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

  return (
    <AppShell activeTab="ai-chatbot">
        <div className="destinations-content-chat">
          <section className="chat-shell">
            <header className="chat-header">
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
                  {isSending ? <span className="chat-send-spinner" aria-label="Sending message" /> : "Send"}
                </button>
              </div>
              {error && <p className="chat-error">{error}</p>}
            </form>
          </section>
        </div>
    </AppShell>
  );
}
