import { FormEvent, useMemo, useState } from "react";

type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
};

function formatTimestamp(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "Unknown time";
  }

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
  const sessionId = "57076c76-ad4c-4124-8a80-f4c151366844";

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = useMemo(
    () => draft.trim().length > 0 && !isSending,
    [draft, isSending]
  );

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();

    if (!content || isSending) {
      return;
    }

    setIsSending(true);
    try {
      const userMessage: ChatMessage = {
        id: `${Date.now()}-user`,
        role: "user",
        content,
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, userMessage]);
      setDraft("");
      setError(null);

      const agentResponse = await fetch("/api/agent", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          prompt: content,
          session_id: sessionId
        })
      });
      const agentRawResponse = await agentResponse.text();
      if (!agentResponse.ok) {
        let errorMessage = agentRawResponse;
        try {
          const parsed = JSON.parse(agentRawResponse) as {
            error?: string;
            requestId?: string;
          };
          if (typeof parsed.error === "string") {
            errorMessage = parsed.error;
          }
          if (typeof parsed.requestId === "string") {
            errorMessage = `${errorMessage} (requestId: ${parsed.requestId})`;
          }
        } catch {
          // Keep raw response text.
        }
        throw new Error(`Agent request failed (${agentResponse.status}): ${errorMessage}`);
      }

      const assistantMessage: ChatMessage = {
        id: `${Date.now()}-assistant`,
        role: "assistant",
        content: extractAssistantText(agentRawResponse),
        createdAt: new Date().toISOString()
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (sendError) {
      setError(
        sendError instanceof Error ? sendError.message : "Failed to send message."
      );
    } finally {
      setIsSending(false);
    }
  };

  return (
    <main className="chat-page">
      <section className="chat-shell">
        <header className="chat-header">
          <h1>AI Travel Chatbot</h1>
          <p>Ask travel questions and view the conversation from your database.</p>
        </header>

        <div className="chat-messages" role="log" aria-live="polite">
          {messages.length === 0 && (
            <p className="chat-state">No messages yet. Start the conversation.</p>
          )}
          {messages.map((message) => (
            <article className="chat-message" key={message.id}>
              <div className="chat-message-meta">
                <strong>{message.role}</strong>
                <span>{formatTimestamp(message.createdAt)}</span>
              </div>
              <p>{message.content}</p>
            </article>
          ))}
        </div>

        <form className="chat-form" onSubmit={handleSubmit}>
          <label className="chat-form-label" htmlFor="chat-input">
            Message
          </label>
          <div className="chat-form-row">
            <input
              id="chat-input"
              className="chat-input"
              type="text"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Type your message..."
              maxLength={2000}
            />
            <button className="chat-send-button" type="submit" disabled={!canSend}>
              {isSending ? "Sending..." : "Send"}
            </button>
          </div>
          {error && <p className="chat-error">{error}</p>}
        </form>
      </section>
    </main>
  );
}
