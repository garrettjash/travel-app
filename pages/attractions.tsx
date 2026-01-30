import { useEffect, useState } from "react";

type Attraction = Record<string, unknown>;

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: Attraction[] };

export default function AttractionsPage() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let isMounted = true;

    async function loadAttractions() {
      const response = await fetch("/api/attractions");
      const payload = (await response.json()) as
        | { data: Attraction[] }
        | { error: string };

      if (!isMounted) {
        return;
      }

      if (!response.ok || "error" in payload) {
        setState({
          status: "error",
          message: "error" in payload ? payload.error : "Request failed"
        });
        return;
      }

      setState({ status: "ok", data: payload.data ?? [] });
    }

    loadAttractions().catch(() => {
      if (isMounted) {
        setState({ status: "error", message: "Unknown error" });
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return (
    <main className="page">
      <header className="hero">
        <h1>Attractions (test)</h1>
        <p>Reading from the Supabase table named &quot;attraction&quot;.</p>
      </header>
      <section className="card">
        {state.status === "loading" && <p>Loading...</p>}
        {state.status === "error" && <p>Error: {state.message}</p>}
        {state.status === "ok" && (
          <>
            <p>Loaded {state.data.length} rows.</p>
            <pre>{JSON.stringify(state.data, null, 2)}</pre>
          </>
        )}
      </section>
    </main>
  );
}
