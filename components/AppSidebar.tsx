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

type AppSidebarProps = {
  activeTab: AppTabKey;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
};

const NAV_ITEMS: Array<{ key: AppTabKey; label: string; icon: string; href: string }> = [
  { key: "start", label: "Start Planning", icon: "🧭", href: "/planning-options" },
  { key: "solo-planner", label: "Plan My Trip", icon: "🧳", href: "/solo-planner" },
  { key: "collab-planner", label: "Group Collab", icon: "🤝", href: "/collab-planner" },
  { key: "destinations", label: "Destinations", icon: "🗺️", href: "/home" },
  { key: "itinerary", label: "Itinerary", icon: "💾", href: "/saved-trips" },
  { key: "my-itineraries", label: "My Itineraries", icon: "📋", href: "/my-itineraries" },
  { key: "favorites", label: "Favorites", icon: "❤", href: "/favorites" },
  { key: "collaborate", label: "Collaborate", icon: "👥", href: "/collaborate" },
  { key: "ai-chatbot", label: "AI Chatbot", icon: "✨", href: "/ai-chatbot" },
  { key: "about", label: "About", icon: "ℹ️", href: "/about" }
];

export default function AppSidebar({ activeTab, isCollapsed, onToggleCollapse }: AppSidebarProps) {
  const router = useRouter();

  return (
    <nav
      className={`destinations-sidebar ${isCollapsed ? "destinations-sidebar-collapsed" : ""}`}
      aria-label="Main navigation"
    >
      <button
        type="button"
        className="destinations-sidebar-toggle"
        onClick={onToggleCollapse}
        aria-label={isCollapsed ? "Expand navigation" : "Collapse navigation"}
        title={isCollapsed ? "Expand navigation" : "Collapse navigation"}
      >
        <span aria-hidden="true">{isCollapsed ? "→" : "←"}</span>
        <span className="destinations-tab-label">Collapse</span>
      </button>

      {NAV_ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          className={`destinations-tab ${activeTab === item.key ? "destinations-tab-active" : ""}`}
          onClick={() => router.push(item.href)}
          aria-current={activeTab === item.key ? "page" : undefined}
          title={item.label}
        >
          <span aria-hidden="true">{item.icon}</span>
          <span className="destinations-tab-label">{item.label}</span>
        </button>
      ))}
    </nav>
  );
}
