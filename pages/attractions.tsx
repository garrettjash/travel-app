import { useEffect, useState } from "react";
import { supabase } from "../lib/supabaseClient";

type Attraction = Record<string, unknown>;

type LoadState =
  | { status: "loading" }
  | { status: "missing-env" }
  | { status: "error"; message: string }
  | { status: "ok"; data: Attraction[] };

export default function AttractionsPage() {
  const [state, setState] = useState<LoadState>(
    supabase ? { status: "loading" } : { status: "missing-env" }
  );

  useEffect(() => {
    if (!supabase) {
      return;
    }

    let isMounted = true;

    async function loadAttractions() {
      const { data, error } = await supabase
        .from("attraction")
        .select("*")
        .limit(25);

      if (!isMounted) {
        return;
      }

      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }

      setState({ status: "ok", data: data ?? [] });
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
        <p>Reading from the Supabase table named "attraction".</p>
      </header>
      <section className="card">
        {state.status === "loading" && <p>Loading...</p>}
        {state.status === "missing-env" && (
          <p>Missing NEXT_PUBLIC_SUPABASE_* env vars.</p>
        )}
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
