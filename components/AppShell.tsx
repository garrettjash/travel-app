import { ReactNode } from "react";
import { useRouter } from "next/router";
import AuthButton from "./AuthButton";
import AppTopNav, { AppTabKey } from "./AppTopNav";
import { useAuth } from "../lib/auth-context";

type AppShellProps = {
  activeTab?: AppTabKey;
  children: ReactNode;
  topbarActions?: ReactNode;
};

export default function AppShell({ activeTab, children, topbarActions }: AppShellProps) {
  const router = useRouter();
  const { user, loading, isEmailVerified, resendVerificationEmail } = useAuth();
  const isUnverified = Boolean(user && !loading && !isEmailVerified);

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
        <div className="destinations-content">
          {isUnverified && (
            <section className="about-card" style={{ borderColor: "#fde68a", background: "rgba(255, 251, 235, 0.92)" }}>
              <h2 style={{ margin: 0 }}>Verify your email to continue</h2>
              <p style={{ marginTop: 8 }}>
                We sent a verification link to <strong>{user?.email}</strong>. Please verify your email, then refresh this page.
              </p>
              <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  type="button"
                  className="saved-trips-button saved-trips-button-primary"
                  onClick={async () => {
                    if (!user?.email) return;
                    await resendVerificationEmail(user.email);
                    window.alert("Verification email sent. Check your inbox.");
                  }}
                >
                  Resend verification email
                </button>
                <button
                  type="button"
                  className="saved-trips-button"
                  onClick={() => router.push("/login")}
                >
                  Back to login
                </button>
              </div>
            </section>
          )}
          <div className={isUnverified ? "email-verify-locked" : undefined}>{children}</div>
        </div>
      </section>
    </main>
  );
}
