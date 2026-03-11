import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import AttractionsExplorer from "../components/AttractionsExplorer";

export default function HomePage() {
  const router = useRouter();
  const placeQuery = router.query.place;
  const initialPlace = Array.isArray(placeQuery) ? placeQuery[0] : placeQuery;

  return (
    <AppShell activeTab="destinations">
      <AttractionsExplorer
        title="Top Choices For Your Selections"
        subtitle="Explore attractions based on your filters."
        initialPlace={initialPlace}
      />
    </AppShell>
  );
}
