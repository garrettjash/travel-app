import { useState, useEffect } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import { useAuth } from "../lib/auth-context";
import { supabase } from "../lib/supabaseClient";

export default function SettingsPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    const meta = (user.user_metadata ?? {}) as any;
    setFirstName(meta.first_name ?? "");
    setLastName(meta.last_name ?? "");
    setEmail(user.email ?? "");
  }, [user]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setMessage(null);
    if (!supabase) {
      setMessage("Supabase not configured");
      return;
    }
    setIsSaving(true);
    try {
      const updates: Record<string, unknown> = {
        data: { first_name: firstName, last_name: lastName }
      };
      // only include email if changed
      if (email && user?.email !== email) updates.email = email;

      const { data, error } = await supabase.auth.updateUser(updates as any);
      if (error) {
        setMessage(error.message);
      } else {
        setMessage("Profile updated.");
        // auth state should update via onAuthStateChange; keep user on page
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  }

  if (loading) return <AppShell><div className="about-card"><p>Loading...</p></div></AppShell>;
  if (!user) {
    router.push(`/login?next=${encodeURIComponent(router.asPath)}`);
    return null;
  }

  return (
    <AppShell>
      <div style={{ maxWidth: 720, margin: "24px auto" }}>
        <section className="about-card">
          <h1>Account Settings</h1>
          <p style={{ marginTop: 8 }}>Edit your name and email address.</p>
        </section>

        <section className="about-card" style={{ marginTop: 12 }}>
          <form onSubmit={handleSave} className="settings-form">
            <div style={{ display: "grid", gap: 12 }}>
              <div>
                <label>First name</label>
                <input
                  type="text"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>

              <div>
                <label>Last name</label>
                <input
                  type="text"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>

              <div>
                <label>Email</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                <p style={{ margin: "6px 0 0", color: "#6b7280", fontSize: 13 }}>
                  Changing your email will send a confirmation depending on your provider.
                </p>
              </div>

              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="submit" className="saved-trips-button saved-trips-button-primary" disabled={isSaving}>
                  {isSaving ? "Saving..." : "Save changes"}
                </button>
                {message && <span style={{ color: "#374151" }}>{message}</span>}
              </div>
            </div>
          </form>
        </section>
      </div>
    </AppShell>
  );
}
