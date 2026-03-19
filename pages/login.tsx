import { useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp, resendVerificationEmail } = useAuth();
  const nextQuery = Array.isArray(router.query.next) ? router.query.next[0] : router.query.next;
  const redirectPath =
    typeof nextQuery === "string" && nextQuery.startsWith("/") ? nextQuery : "/";
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resending, setResending] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error: err } = await signIn(email, password);
        if (err) {
          setError(err.message);
          return;
        }
        router.push(redirectPath);
      } else {
        const { error: err } = await signUp(email, password, firstName, lastName);
        if (err) {
          setError(err.message);
          return;
        }
        setInfo("Account created. Check your email to verify your account, then sign in.");
        setMode("login");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    const trimmed = email.trim();
    if (!trimmed) {
      setError("Enter your email above, then click resend.");
      return;
    }
    setError(null);
    setInfo(null);
    setResending(true);
    try {
      const { error: err } = await resendVerificationEmail(trimmed);
      if (err) {
        setError(err.message);
        return;
      }
      setInfo("Verification email sent. Please check your inbox.");
    } finally {
      setResending(false);
    }
  };

  return (
    <main className="login-page-shell">
      <header className="login-page-header">
        <button
          type="button"
          className="destinations-brand destinations-brand-button"
          onClick={() => router.push("/")}
        >
          TravelApp
        </button>
        <button
          type="button"
          className="destinations-login"
          onClick={() => {
            if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
              return;
            }
            router.push("/");
          }}
        >
          Back to app
        </button>
      </header>
      <section className="login-page-content">
        <div className="login-page-card">
          <div className="login-page-tabs">
            <button
              type="button"
              className={`login-page-tab ${mode === "login" ? "login-page-tab-active" : ""}`}
              onClick={() => {
                setMode("login");
                setError(null);
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              className={`login-page-tab ${mode === "register" ? "login-page-tab-active" : ""}`}
              onClick={() => {
                setMode("register");
                setError(null);
              }}
            >
              Create account
            </button>
          </div>

          <form onSubmit={handleSubmit} className="login-page-form">
            {mode === "register" && (
              <>
                <div className="login-page-field">
                  <label htmlFor="firstName">First name</label>
                  <input
                    id="firstName"
                    type="text"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    required={mode === "register"}
                    autoComplete="given-name"
                  />
                </div>
                <div className="login-page-field">
                  <label htmlFor="lastName">Last name</label>
                  <input
                    id="lastName"
                    type="text"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    required={mode === "register"}
                    autoComplete="family-name"
                  />
                </div>
              </>
            )}
            <div className="login-page-field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
              />
            </div>
            <div className="login-page-field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete={mode === "login" ? "current-password" : "new-password"}
              />
            </div>
            {error && (
              <p className="login-page-error" role="alert">
                {error}
              </p>
            )}
            {info && (
              <p className="login-page-info" role="status">
                {info}
              </p>
            )}
            <button
              type="submit"
              className="login-page-submit"
              disabled={loading}
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>

            {mode === "login" && (
              <button
                type="button"
                className="login-page-resend"
                onClick={handleResend}
                disabled={resending}
              >
                {resending ? "Sending…" : "Resend verification email"}
              </button>
            )}
          </form>
        </div>
      </section>
    </main>
  );
}
