import { ReactNode, useEffect, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "./AuthButton";
import AppSidebar, { AppTabKey } from "./AppSidebar";

type AppShellProps = {
  activeTab: AppTabKey;
  children: ReactNode;
  topbarActions?: ReactNode;
  hiddenTabs?: AppTabKey[];
};

const SIDEBAR_STORAGE_KEY = "travelapp-sidebar-collapsed";

export default function AppShell({ activeTab, children, topbarActions, hiddenTabs }: AppShellProps) {
  const router = useRouter();
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsSidebarCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  return (
    <main className="destinations-page">
      <header className="destinations-topbar">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <div className="destinations-topbar-actions">
          <AuthButton />
          {topbarActions}
        </div>
      </header>

      <section className={`destinations-layout ${isSidebarCollapsed ? "destinations-layout-collapsed" : ""}`}>
        <AppSidebar
          activeTab={activeTab}
          isCollapsed={isSidebarCollapsed}
          onToggleCollapse={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
          hiddenTabs={hiddenTabs}
        />

        <div className="destinations-content">{children}</div>
      </section>
    </main>
  );
}
