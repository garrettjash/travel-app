import { useEffect, useState } from "react";

type HealthState = {
  status: "loading" | "ok" | "error";
  message: string;
};

export default function Home() {
  const [health, setHealth] = useState<HealthState>({
    status: "loading",
    message: ""
  });
  const [supabaseStatus, setSupabaseStatus] = useState<
    "loading" | "ok" | "error"
  >("loading");

  useEffect(() => {
    let isMounted = true;

    async function loadHealth() {
      try {
        const response = await fetch("/api/health");
        const data = await response.json();
        if (isMounted) {
          setHealth({ status: "ok", message: data.message || "ok" });
        }
      } catch (error) {
        if (!isMounted) {
          return;
        }

        const message =
          error instanceof Error ? error.message : "Unknown error";
        setHealth({ status: "error", message });
      }
    }

    loadHealth();

    return () => {
      isMounted = false;
    };
  }, []);
  useEffect(() => {
    let isMounted = true;

    async function checkSupabase() {
      try {
        const response = await fetch("/api/attractions?limit=1");
        if (!isMounted) {
          return;
        }
        setSupabaseStatus(response.ok ? "ok" : "error");
      } catch {
        if (isMounted) {
          setSupabaseStatus("error");
        }
      }
    }

    checkSupabase();

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="page">
      <header className="hero">
        <h1>Travel App</h1>
        <p>Next.js app with frontend and API routes.</p>
      </header>
      <section className="card">
        <h2>API status</h2>
        <p className={`status status-${health.status}`}>
          {health.status === "loading" ? "Checking..." : health.message}
        </p>
        <p className="note">Health check is served from /api/health.</p>
      </section>
      <section className="card">
        <h2>Supabase status</h2>
        <p className={`status status-${supabaseStatus}`}>
          {supabaseStatus === "loading" && "Checking..."}
          {supabaseStatus === "ok" && "Supabase API route ok"}
          {supabaseStatus === "error" && "Supabase check failed"}
        </p>
        <p className="note">
          Update <code>.env.local</code> with your Supabase URL and anon key.
        </p>
        <p className="note">
          Test data page: <a href="/attractions">/attractions</a>
        </p>
      </section>
    </main>
  );
}
