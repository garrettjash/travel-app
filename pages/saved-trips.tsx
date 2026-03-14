import { useEffect } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";

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

export default function SavedTripsPage() {
  const router = useRouter();

  useEffect(() => {
    const id = generateItineraryId();
    router.replace(`/saved-trips/${encodeURIComponent(id)}`, undefined, { shallow: false });
  }, [router]);

  return (
    <AppShell>
      <section className="about-card">
        <h1>Loading...</h1>
        <p>Preparing your itinerary.</p>
      </section>
    </AppShell>
  );
}

