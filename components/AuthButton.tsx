import { useRouter } from "next/router";
import { useCallback, useRef, useState } from "react";
import { useAuth } from "../lib/auth-context";

type AuthButtonProps = {
  loginHref?: string;
};

export default function AuthButton({ loginHref = "/login" }: AuthButtonProps) {
  const router = useRouter();
  const { user, loading, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const handleLogout = useCallback(async () => {
    await signOut();
    setMenuOpen(false);
  }, [signOut]);

  if (loading) {
    return (
      <button type="button" className="destinations-login" disabled>
        …
      </button>
    );
  }

  if (!user) {
    return (
      <button
        type="button"
        className="destinations-login"
        onClick={() => router.push(loginHref)}
      >
        Login
      </button>
    );
  }

  const meta = user.user_metadata ?? {};
  const firstName = meta.first_name ?? "";
  const lastName = meta.last_name ?? "";
  const displayName =
    firstName || lastName ? [firstName, lastName].filter(Boolean).join(" ").trim() : user.email ?? "Account";

  return (
    <div className="auth-button-wrap" ref={menuRef}>
      <button
        type="button"
        className="destinations-login auth-button-trigger"
        onClick={() => setMenuOpen((o) => !o)}
        aria-expanded={menuOpen}
        aria-haspopup="true"
      >
        <span>{displayName}</span>
        <span
          className={`auth-button-chevron ${menuOpen ? "auth-button-chevron-open" : ""}`}
          aria-hidden="true"
        >
          ▾
        </span>
      </button>
      {menuOpen && (
        <>
          <button
            type="button"
            className="auth-button-backdrop"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="auth-button-menu" role="menu">
            <span className="auth-button-menu-email">{user.email}</span>
            <button
              type="button"
              className="auth-button-menu-item"
              role="menuitem"
              onClick={() => {
                router.push("/my-itineraries");
                setMenuOpen(false);
              }}
            >
              My Itineraries
            </button>
            <button
              type="button"
              className="auth-button-menu-item"
              role="menuitem"
              onClick={() => {
                router.push("/favorites");
                setMenuOpen(false);
              }}
            >
              Favorites
            </button>
            <button
              type="button"
              className="auth-button-menu-item"
              role="menuitem"
              onClick={handleLogout}
            >
              Sign out
            </button>
          </div>
        </>
      )}
    </div>
  );
}
