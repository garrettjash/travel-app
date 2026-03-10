import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";

export default function AboutPage() {
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
        <AuthButton />
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/saved-trips")}>
            <span aria-hidden="true">💾</span>
            <span>Itinerary</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/favorites")}>
            <span aria-hidden="true">❤</span>
            <span>Favorites</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/collaborate")}>
            <span aria-hidden="true">👥</span>
            <span>Collaborate</span>
          </button>
          <button type="button" className="destinations-tab" onClick={() => router.push("/ai-chatbot")}>
            <span aria-hidden="true">✨</span>
            <span>AI Chatbot</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">ℹ️</span>
            <span>About</span>
          </button>
        </nav>

        <div className="destinations-content">
          <section className="about-card">
            <h1>About TravelApp</h1>
            <p>
              TravelApp helps you discover attractions, save favorites, build a quick itinerary, and ask the AI
              chatbot for planning ideas in one workspace.
            </p>
          </section>

          <section className="about-card">
            <h2>What This Site Does</h2>
            <ul className="about-list">
              <li>Shows destination and attraction data to support trip planning.</li>
              <li>Lets you bookmark places and draft a day-by-day trip outline.</li>
              <li>Provides AI-generated suggestions based on your prompts.</li>
            </ul>
          </section>

          <section className="about-card">
            <h2>Legal & Important Notes</h2>
            <ul className="about-list">
              <li>
                Informational use only: content is for planning help and not professional legal, medical, financial,
                or safety advice.
              </li>
              <li>
                No guarantees: attraction details, pricing, operating hours, and availability can change at any time.
              </li>
              <li>
                AI limitations: chatbot responses may be incomplete or incorrect; confirm important details directly
                with official sources.
              </li>
              <li>
                Third-party content: linked or sourced external content belongs to its respective owners and may have
                separate terms.
              </li>
              <li>
                Privacy reminder: avoid sharing sensitive personal information in chat prompts or notes unless you are
                comfortable storing it.
              </li>
            </ul>
            <p className="about-updated">Last updated: March 4, 2026</p>
          </section>
        </div>
      </section>
    </main>
  );
}
