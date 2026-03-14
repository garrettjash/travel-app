import { useEffect } from "react";
import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";
import AppTopNav from "../components/AppTopNav";

function generateItineraryId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    try {
      return crypto.randomUUID();
    } catch {
      /* fallback */
    }
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export default function SoloPlannerPage() {
  const router = useRouter();

  useEffect(() => {
    if (!router.isReady) return;
    const id = generateItineraryId();
    const place = router.query.place;
    const placeParam = typeof place === "string" ? `?place=${encodeURIComponent(place)}` : "";
    router.replace(`/solo-planner/${encodeURIComponent(id)}${placeParam}`, undefined, {
      shallow: false
    });
  }, [router.isReady, router.query.place]);

  return (
    <main className="solo-planner-page">
      <header className="destinations-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <AppTopNav activeTab="solo-planner" />
        <div className="destinations-topbar-actions">
          <AuthButton />
        </div>
      </header>
      <section className="solo-planner-main">
        <div className="solo-itinerary-panel-inner planner-pane-surface" style={{ padding: "2rem" }}>
          <h2>Loading...</h2>
          <p>Preparing your itinerary.</p>
        </div>
      </section>
    </main>
  );
}
