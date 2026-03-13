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
  hiddenTabs?: AppTabKey[];
};

const NAV_ITEMS: Array<{ key: AppTabKey; label: string; icon: string; href: string }> = [
  { key: "solo-planner", label: "Plan My Trip", icon: "🧳", href: "/solo-planner" },
  { key: "collaborate", label: "Collaborate", icon: "👥", href: "/collaborate" },
  { key: "destinations", label: "Destinations", icon: "🗺️", href: "/home" },
  { key: "about", label: "About", icon: "ℹ️", href: "/about" }
];

export default function AppSidebar({ activeTab, isCollapsed, onToggleCollapse, hiddenTabs = [] }: AppSidebarProps) {
  const router = useRouter();
  const visibleItems = NAV_ITEMS.filter((item) => !hiddenTabs.includes(item.key));

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

      {visibleItems.map((item) => (
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
