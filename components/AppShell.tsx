import { ReactNode } from "react";
import { useRouter } from "next/router";
import AuthButton from "./AuthButton";
import AppTopNav, { AppTabKey } from "./AppTopNav";

type AppShellProps = {
  activeTab?: AppTabKey;
  children: ReactNode;
  topbarActions?: ReactNode;
};

export default function AppShell({ activeTab, children, topbarActions }: AppShellProps) {
  const router = useRouter();

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
        <AppTopNav activeTab={activeTab} />
        <div className="destinations-topbar-actions">
          <AuthButton />
          {topbarActions}
        </div>
      </header>

      <section className="destinations-layout">
        <div className="destinations-content">{children}</div>
      </section>
    </main>
  );
}
