import { useMemo, useState } from "react";
import { useRouter } from "next/router";
import LoginNoticeModal from "../components/LoginNoticeModal";
import { FavoriteAttraction, useFavorites } from "../lib/favorites-context";

type Pace = "relaxed" | "balanced" | "packed";
type Slot = "Morning" | "Afternoon" | "Evening";

type PlannedStop = {
  attraction: FavoriteAttraction;
  slot: Slot;
};

type DayPlan = {
  dayNumber: number;
  stops: PlannedStop[];
};

type BuildResult = {
  days: DayPlan[];
  unscheduled: FavoriteAttraction[];
};

const slotOrder: Slot[] = ["Morning", "Afternoon", "Evening"];

function formatLocation(city: string, stateProvince: string, country: string) {
  return [city, stateProvince, country].filter(Boolean).join(", ") || "Location unavailable";
}

function daysBetween(startDate: string, endDate: string) {
  if (!startDate || !endDate) return 3;

  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return 3;

  const msDiff = end.getTime() - start.getTime();
  const dayDiff = Math.floor(msDiff / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, dayDiff);
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function buildItinerary(
  favorites: FavoriteAttraction[],
  tripDays: number,
  pace: Pace,
  randomize: boolean
): BuildResult {
  const stopsPerDay = pace === "relaxed" ? 1 : pace === "packed" ? 3 : 2;
  const capacity = tripDays * stopsPerDay;
  const source = randomize ? shuffle(favorites) : [...favorites];
  const picked = source.slice(0, capacity);
  const unscheduled = source.slice(capacity);

  const days: DayPlan[] = Array.from({ length: tripDays }, (_, index) => ({
    dayNumber: index + 1,
    stops: []
  }));

  picked.forEach((attraction, index) => {
    const dayIndex = Math.floor(index / stopsPerDay);
    const slotIndex = index % stopsPerDay;
    const slot = slotOrder[slotIndex] ?? "Afternoon";

    days[dayIndex].stops.push({ attraction, slot });
  });

  return { days, unscheduled };
}

export default function SavedTripsPage() {
  const router = useRouter();
  const { favorites, isFavorite } = useFavorites();

  const today = new Date();
  const defaultStart = today.toISOString().slice(0, 10);
  const defaultEnd = new Date(today.getTime() + 1000 * 60 * 60 * 24 * 2).toISOString().slice(0, 10);

  const [tripName, setTripName] = useState("My Weekend Escape");
  const [startDate, setStartDate] = useState(defaultStart);
  const [endDate, setEndDate] = useState(defaultEnd);
  const [pace, setPace] = useState<Pace>("balanced");
  const [notes, setNotes] = useState("");
  const [dayPlans, setDayPlans] = useState<DayPlan[]>([]);
  const [unscheduled, setUnscheduled] = useState<FavoriteAttraction[]>([]);
  const [isLoginNoticeOpen, setIsLoginNoticeOpen] = useState(false);

  const tripDays = useMemo(() => daysBetween(startDate, endDate), [startDate, endDate]);
  const totalStops = dayPlans.reduce((sum, day) => sum + day.stops.length, 0);
  const activeTripName = tripName.trim() || "Untitled Trip";

  const handleBuild = (randomize: boolean) => {
    if (favorites.length === 0) {
      setDayPlans([]);
      setUnscheduled([]);
      return;
    }

    const built = buildItinerary(favorites, tripDays, pace, randomize);
    setDayPlans(built.days);
    setUnscheduled(built.unscheduled);
  };

  const clearPlan = () => {
    setDayPlans([]);
    setUnscheduled([]);
    setNotes("");
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
        <button type="button" className="destinations-login" onClick={() => setIsLoginNoticeOpen(true)}>
          Login
        </button>
      </header>

      <section className="destinations-layout">
        <nav className="destinations-sidebar" aria-label="Main navigation">
          <button type="button" className="destinations-tab" onClick={() => router.push("/home")}>
            <span aria-hidden="true">🗺️</span>
            <span>Destinations</span>
          </button>
          <button type="button" className="destinations-tab destinations-tab-active">
            <span aria-hidden="true">💾</span>
            <span>Saved Trips</span>
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
          <button type="button" className="destinations-tab" onClick={() => router.push("/about")}>
            <span aria-hidden="true">ℹ️</span>
            <span>About</span>
          </button>
        </nav>

        <div className="destinations-content">
          <section className="saved-trips-header">
            <h1>Saved Trips Studio</h1>
            <p>Turn your favorites into a ready-to-go itinerary in one click.</p>
          </section>

          <section className="saved-trips-builder">
            <div className="saved-trips-field">
              <label htmlFor="trip-name">Trip Name</label>
              <input
                id="trip-name"
                type="text"
                value={tripName}
                onChange={(event) => setTripName(event.target.value)}
                placeholder="Name your trip"
              />
            </div>
            <div className="saved-trips-field">
              <label htmlFor="trip-start">Start</label>
              <input
                id="trip-start"
                type="date"
                value={startDate}
                onChange={(event) => setStartDate(event.target.value)}
              />
            </div>
            <div className="saved-trips-field">
              <label htmlFor="trip-end">End</label>
              <input
                id="trip-end"
                type="date"
                value={endDate}
                onChange={(event) => setEndDate(event.target.value)}
              />
            </div>
            <div className="saved-trips-field">
              <label htmlFor="trip-pace">Pace</label>
              <select
                id="trip-pace"
                value={pace}
                onChange={(event) => setPace(event.target.value as Pace)}
              >
                <option value="relaxed">Relaxed (1 stop/day)</option>
                <option value="balanced">Balanced (2 stops/day)</option>
                <option value="packed">Packed (3 stops/day)</option>
              </select>
            </div>
            <div className="saved-trips-actions">
              <button type="button" className="saved-trips-button saved-trips-button-primary" onClick={() => handleBuild(false)}>
                Build Itinerary
              </button>
              <button type="button" className="saved-trips-button" onClick={() => handleBuild(true)}>
                Surprise Me
              </button>
              <button type="button" className="saved-trips-button saved-trips-button-muted" onClick={clearPlan}>
                Clear Plan
              </button>
            </div>
          </section>

          <section className="saved-trips-stats">
            <article>
              <h3>Trip</h3>
              <p>{activeTripName}</p>
            </article>
            <article>
              <h3>Days</h3>
              <p>{tripDays}</p>
            </article>
            <article>
              <h3>Favorites Available</h3>
              <p>{favorites.length}</p>
            </article>
            <article>
              <h3>Stops Scheduled</h3>
              <p>{totalStops}</p>
            </article>
          </section>

          {favorites.length === 0 ? (
            <section className="saved-trips-empty">
              <h2>No favorites yet</h2>
              <p>Add attractions to favorites first, then build a trip here.</p>
              <div className="saved-trips-empty-actions">
                <button type="button" className="saved-trips-button saved-trips-button-primary" onClick={() => router.push("/home")}>
                  Browse Destinations
                </button>
                <button type="button" className="saved-trips-button" onClick={() => router.push("/favorites")}>
                  Open Favorites
                </button>
              </div>
            </section>
          ) : (
            <>
              <section className="saved-trips-notes">
                <label htmlFor="trip-notes">Trip Notes</label>
                <textarea
                  id="trip-notes"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  placeholder="Add reminders: reservations, neighborhood plans, must-eat spots..."
                  rows={3}
                />
              </section>

              <section className="saved-trips-timeline">
                {dayPlans.length === 0 ? (
                  <p className="saved-trips-state">
                    Build an itinerary to see your day-by-day plan.
                  </p>
                ) : (
                  dayPlans.map((day) => (
                    <article className="saved-day-card" key={day.dayNumber}>
                      <header>
                        <h2>Day {day.dayNumber}</h2>
                      </header>

                      {day.stops.length === 0 ? (
                        <p className="saved-day-empty">No stops for this day.</p>
                      ) : (
                        <div className="saved-day-stops">
                          {day.stops.map((stop) => (
                            <div className="saved-stop" key={`${day.dayNumber}-${stop.attraction.id}-${stop.slot}`}>
                              <span className="saved-stop-slot">{stop.slot}</span>
                              <div className="saved-stop-content">
                                <h3>{stop.attraction.name}</h3>
                                <p>{formatLocation(stop.attraction.city, stop.attraction.stateProvince, stop.attraction.country)}</p>
                                {stop.attraction.categories.length > 0 && (
                                  <p className="saved-stop-tags">{stop.attraction.categories.slice(0, 3).join(" • ")}</p>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </article>
                  ))
                )}
              </section>

              {unscheduled.length > 0 && (
                <section className="saved-trips-unscheduled">
                  <h2>Still on your list</h2>
                  <p>These did not fit your current date range and pace.</p>
                  <div className="saved-unscheduled-grid">
                    {unscheduled.map((attraction) => (
                      <article className="saved-unscheduled-item" key={attraction.id}>
                        <h3>{attraction.name}</h3>
                        <p>{formatLocation(attraction.city, attraction.stateProvince, attraction.country)}</p>
                        <span>{isFavorite(attraction.id) ? "Favorited" : "Not favorited"}</span>
                      </article>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </section>
      <LoginNoticeModal isOpen={isLoginNoticeOpen} onClose={() => setIsLoginNoticeOpen(false)} />
    </main>
  );
}
