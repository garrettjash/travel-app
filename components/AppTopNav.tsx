import { useRouter } from "next/router";

export type AppTabKey =
  | "start"
  | "solo-planner"
  | "collab-planner"
  | "destinations"
  | "itinerary"
  | "my-itineraries"
  | "favorites"
  | "collaborate"
  | "ai-chatbot"
  | "about";

type AppTopNavProps = {
  activeTab?: AppTabKey;
};

const NAV_ITEMS: Array<{ key: AppTabKey; label: string; href: string }> = [
  { key: "about", label: "About", href: "/about" },
  { key: "solo-planner", label: "Plan My Trip", href: "/solo-planner" },
  { key: "collaborate", label: "Collaborate", href: "/collaborate" },
  { key: "destinations", label: "Destinations", href: "/home" }
];

export default function AppTopNav({ activeTab }: AppTopNavProps) {
  const router = useRouter();

  return (
    <nav className="app-top-nav" aria-label="Main navigation">
      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`app-top-nav-item ${activeTab === item.key ? "app-top-nav-item-active" : ""}`}
          onClick={() => router.push(item.href)}
          aria-current={activeTab === item.key ? "page" : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  );
}
