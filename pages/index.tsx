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
        if (isMounted) {
          setHealth({ status: "error", message: error.message });
        }
      }
    }

    loadHealth();

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
    </main>
  );
}
