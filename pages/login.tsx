import { useState } from "react";
import { useRouter } from "next/router";
import { useAuth } from "../lib/auth-context";

export default function LoginPage() {
  const router = useRouter();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      if (mode === "login") {
        const { error: err } = await signIn(email, password);
        if (err) {
          setError(err.message);
          return;
        }
        router.push("/home");
      } else {
        const { error: err } = await signUp(email, password, firstName, lastName);
        if (err) {
          setError(err.message);
          return;
        }
        router.push("/home");
      }
    } finally {
      setLoading(false);
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
          onClick={() => router.push("/home")}
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
            <button
              type="submit"
              className="login-page-submit"
              disabled={loading}
            >
              {loading ? "Please wait…" : mode === "login" ? "Sign in" : "Create account"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
