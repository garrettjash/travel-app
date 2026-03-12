import { useRouter } from "next/router";
import AppShell from "../components/AppShell";

const funnyTravelDogImage =
  "https://images.unsplash.com/photo-1544568100-847a948585b9?auto=format&fit=crop&w=1400&q=80";

function getFeatureLabel(feature: string | string[] | undefined) {
  const raw = Array.isArray(feature) ? feature[0] : feature;
  if (raw === "flights") return "Flights";
  return "Stays";
}

export default function ComingSoonPage() {
  const router = useRouter();
  const featureLabel = getFeatureLabel(router.query.feature);

  return (
    <AppShell activeTab="destinations">
          <section className="coming-soon-card">
            <img src={funnyTravelDogImage} alt="Funny travel companion" className="coming-soon-image" />
            <h1>{featureLabel} Are Not Here Yet</h1>
            <p>
              Right now, we do not have {featureLabel.toLowerCase()} available.
              We may be adding {featureLabel.toLowerCase()} later.
            </p>
          </section>
    </AppShell>
  );
}
