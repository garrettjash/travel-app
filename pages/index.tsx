import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

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
    "loading" | "ok" | "error" | "missing"
  >(supabase ? "loading" : "missing");

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
    if (!supabase) {
      return;
    }

    let isMounted = true;

    async function checkSupabase() {
      const { error } = await supabase.auth.getSession();
      if (!isMounted) {
        return;
      }

      setSupabaseStatus(error ? "error" : "ok");
    }

    checkSupabase().catch(() => {
      if (isMounted) {
        setSupabaseStatus("error");
      }
    });

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
          {supabaseStatus === "ok" && "Supabase client initialized"}
          {supabaseStatus === "error" && "Supabase check failed"}
          {supabaseStatus === "missing" &&
            "Missing NEXT_PUBLIC_SUPABASE_* env vars"}
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
