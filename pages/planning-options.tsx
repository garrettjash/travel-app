import { FormEvent, useState } from "react";
import { useRouter } from "next/router";
import AppShell from "../components/AppShell";
import PlaceSearchInput from "../components/PlaceSearchInput";

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
    router.push("/collaborate");
  };

  const handleGroupSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    goToCollabPlanner();
  };

  return (
    <AppShell
      activeTab="start"
      hiddenTabs={["start"]}
      topbarActions={
        <>
          <button type="button" className="destinations-login" onClick={() => router.push("/old-version")}>
            Old Version
          </button>
        </>
      }
    >
      <section
        className="planning-options-shell planning-options-shell-embedded"
        style={{ backgroundImage: `url(${heroImage})` }}
      >
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
                    <PlaceSearchInput
                      id="group-destination"
                      value={groupDestination}
                      onChange={setGroupDestination}
                      placeholder="Type to search destinations…"
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
                    <PlaceSearchInput
                      id="solo-destination"
                      value={destination}
                      onChange={setDestination}
                      placeholder="Type to search destinations…"
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
    </AppShell>
  );
}
