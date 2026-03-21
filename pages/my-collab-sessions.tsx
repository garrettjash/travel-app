import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/auth-context";

type CollabSessionItem = {
  sessionId: string;
  placeLabel: string;
  createdAt: string | null;
  expiresAt: string | null;
  isExpired: boolean;
  yesVotes: number;
  noVotes: number;
  totalVotes: number;
  itineraryId: string;
  resultsPath: string;
  itineraryPath: string;
};

function formatDate(value: string | null) {
  if (!value) return "Unknown";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Unknown";
  return date.toLocaleString();
}

export default function MyCollabSessionsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [sessions, setSessions] = useState<CollabSessionItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (loading || !user?.id) {
      if (!loading && !user) router.replace("/login?next=/my-collab-sessions");
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    (async () => {
      setIsLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ userId: user.id });
        const response = await fetch(`/api/my-collab-sessions?${params.toString()}`);
        const payload = (await response.json()) as { sessions?: CollabSessionItem[]; error?: string };
        if (cancelled) return;
        if (!response.ok || payload.error) throw new Error(payload.error || "Failed to load sessions.");
        setSessions(payload.sessions ?? []);
      } catch (err) {
        if (cancelled) return;
        setSessions([]);
        setError(err instanceof Error ? err.message : "Failed to load sessions.");
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loading, router, user, user?.id]);

  const activeSessions = useMemo(() => sessions.filter((session) => !session.isExpired), [sessions]);
  const pastSessions = useMemo(() => sessions.filter((session) => session.isExpired), [sessions]);

  return (
    <AppShell activeTab="my-itineraries">
      <div className="my-itineraries-page-content">
        <section className="about-card">
          <h1>My Collab Sessions</h1>
          <p>Track active and past voting sessions, review results, and jump into the linked itinerary.</p>
        </section>

        {isLoading ? (
          <section className="about-card">
            <p>Loading your sessions...</p>
          </section>
        ) : error ? (
          <section className="about-card">
            <p className="login-page-error">{error}</p>
          </section>
        ) : sessions.length === 0 ? (
          <section className="about-card">
            <p>No collab sessions yet. Create one from the Collaborate page.</p>
            <button
              type="button"
              className="saved-trips-button saved-trips-button-primary"
              style={{ marginTop: 12 }}
              onClick={() => router.push("/collaborate")}
            >
              Create a collab session
            </button>
          </section>
        ) : (
          <>
            <section className="about-card">
              <h2>Active</h2>
              {activeSessions.length === 0 ? (
                <p>No active sessions.</p>
              ) : (
                <ul className="my-itineraries-list">
                  {activeSessions.map((session) => (
                    <li key={session.sessionId} className="my-itineraries-row">
                      <div className="my-itineraries-item" style={{ cursor: "default" }}>
                        <span className="my-itineraries-name">{session.placeLabel}</span>
                        <span className="my-itineraries-location">
                          Expires: {formatDate(session.expiresAt)} · Votes: 👍 {session.yesVotes} / 👎 {session.noVotes}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="saved-trips-button"
                        onClick={() => router.push(session.resultsPath)}
                      >
                        View results
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="about-card">
              <h2>Past</h2>
              {pastSessions.length === 0 ? (
                <p>No past sessions.</p>
              ) : (
                <ul className="my-itineraries-list">
                  {pastSessions.map((session) => (
                    <li key={session.sessionId} className="my-itineraries-row">
                      <div className="my-itineraries-item" style={{ cursor: "default" }}>
                        <span className="my-itineraries-name">{session.placeLabel}</span>
                        <span className="my-itineraries-location">
                          Ended: {formatDate(session.expiresAt)} · Votes: 👍 {session.yesVotes} / 👎 {session.noVotes}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="saved-trips-button"
                        onClick={() => router.push(session.resultsPath)}
                      >
                        Results
                      </button>
                      <button
                        type="button"
                        className="saved-trips-button saved-trips-button-primary"
                        onClick={() => router.push(session.itineraryPath)}
                      >
                        Itinerary
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </>
        )}
      </div>
    </AppShell>
  );
}
