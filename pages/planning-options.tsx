import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import AuthButton from "../components/AuthButton";

const heroImage =
  "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?auto=format&fit=crop&w=1600&q=80";

export default function PlanningOptionsPage() {
  const router = useRouter();
  const [showSoloQuestion, setShowSoloQuestion] = useState(false);
  const [showGroupQuestion, setShowGroupQuestion] = useState(false);
  const [answer, setAnswer] = useState<"yes" | "no" | null>(null);
  const [destination, setDestination] = useState("");
  const [groupAnswer, setGroupAnswer] = useState<"yes" | "no" | null>(null);
  const [groupDestination, setGroupDestination] = useState("");

  const goToSoloPlanner = () => {
    const place = destination.trim();
    if (!place) {
      router.push("/solo-planner");
      return;
    }
    router.push({ pathname: "/solo-planner", query: { place } });
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    goToSoloPlanner();
  };

  const goToCollabPlanner = () => {
    const place = groupDestination.trim();
    if (!place) {
      router.push("/collab-planner");
      return;
    }
    router.push({ pathname: "/collab-planner", query: { place } });
  };

  const handleGroupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    goToCollabPlanner();
  };

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

      <section className="planning-options-shell" style={{ backgroundImage: `url(${heroImage})` }}>
        <div className="planning-options-overlay" />
        <div className="planning-options-card">
          <p className="planning-options-eyebrow">How do you want to plan?</p>
          <h1>Would you like to start a group collab session or plan on your own?</h1>
          <p>Choose one path to get started.</p>
          <div className="planning-options-actions">
            <button
              type="button"
              className="planning-option-button"
              onClick={() => {
                setShowGroupQuestion(true);
                setGroupAnswer(null);
                setShowSoloQuestion(false);
              }}
            >
              Start Group Collab Session
            </button>
            <button
              type="button"
              className="planning-option-button"
              onClick={() => {
                setShowSoloQuestion(true);
                setAnswer(null);
                setShowGroupQuestion(false);
              }}
            >
              Plan My Own Trip
            </button>
          </div>
          {showGroupQuestion && (
            <div className="planning-solo-flow">
              <p className="planning-solo-question">Do you already know where your group wants to go?</p>
              <div className="planning-solo-answer-row">
                <button type="button" className="planning-solo-choice" onClick={goToCollabPlanner}>
                  No
                </button>
                <button type="button" className="planning-solo-choice" onClick={() => setGroupAnswer("yes")}>
                  Yes
                </button>
              </div>
              {groupAnswer === "yes" && (
                <form className="planning-solo-form" onSubmit={handleGroupSubmit}>
                  <label className="planning-solo-label" htmlFor="group-destination">
                    Enter destination
                  </label>
                  <div className="planning-solo-input-row">
                    <input
                      id="group-destination"
                      className="planning-solo-input"
                      value={groupDestination}
                      onChange={(event) => setGroupDestination(event.target.value)}
                      placeholder="City or country"
                      required
                    />
                    <button type="submit" className="planning-solo-next">
                      Continue
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
          {showSoloQuestion && (
            <div className="planning-solo-flow">
              <p className="planning-solo-question">Do you already know where you want to go?</p>
              <div className="planning-solo-answer-row">
                <button type="button" className="planning-solo-choice" onClick={goToSoloPlanner}>
                  No
                </button>
                <button type="button" className="planning-solo-choice" onClick={() => setAnswer("yes")}>
                  Yes
                </button>
              </div>
              {answer === "yes" && (
                <form className="planning-solo-form" onSubmit={handleSubmit}>
                  <label className="planning-solo-label" htmlFor="solo-destination">
                    Enter destination
                  </label>
                  <div className="planning-solo-input-row">
                    <input
                      id="solo-destination"
                      className="planning-solo-input"
                      value={destination}
                      onChange={(event) => setDestination(event.target.value)}
                      placeholder="City or country"
                      required
                    />
                    <button type="submit" className="planning-solo-next">
                      Continue
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
