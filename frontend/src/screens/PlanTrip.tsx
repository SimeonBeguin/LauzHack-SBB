// Prevention, idea 3: a normal search, ranked by reliability. At rush hour a
// slightly longer train can beat a shorter bus that is often stuck in traffic:
// the backend says so in `note` ("6 min later than the fastest, but more reliable").
import { useState } from "react";
import { planReliable } from "../api/client";
import { useStore } from "../store";
import { atTime, hhmm, swissDay } from "../lib/format";
import { plannedToAlternative } from "../lib/prevention";
import { ConnectionCard, Header, SectionTitle } from "../components/ui";
import { StopField } from "./CommuterSetup";
import type { PlannedTrip, Stop } from "../types";

export default function PlanTrip() {
  const { back, push, status, clock, planned, setPlanned } = useStore();
  const j = status?.journey;
  const [origin, setOrigin] = useState<Stop | null>(j?.origin ?? null);
  const [destination, setDestination] = useState<Stop | null>(j?.destination ?? null);
  const [day, setDay] = useState(swissDay(clock));
  const [time, setTime] = useState(hhmm(clock));
  const [arriveBy, setArriveBy] = useState("");
  const [result, setResult] = useState<{ ranking: string; trips: PlannedTrip[]; deadline: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);

  async function search() {
    if (!origin || !destination) return;
    setSearching(true);
    setError(null);
    const deadline = arriveBy ? atTime(day, arriveBy) : null;
    try {
      const res = await planReliable({
        origin_stop_id: origin.id, destination_stop_id: destination.id,
        departure: atTime(day, time), deadline, num_results: 5,
      });
      setResult({ ranking: res.ranking, trips: res.trips, deadline });
      setPlanned(res.trips.map((p) => plannedToAlternative(p, !!deadline)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }

  const notes = new Map(result?.trips.map((t) => [t.id, t.note]) ?? []);

  return (
    <>
      <Header title="Plan a trip" onBack={back} />
      <div className="content overlap">
        <section className="card form">
          <StopField label="From" value={origin} onChange={setOrigin} />
          <StopField label="To" value={destination} onChange={setDestination} />
          <div className="field-row">
            <label className="field">
              <span>Date</span>
              <input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
            </label>
            <label className="field">
              <span>Leave at</span>
              <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
            </label>
            <label className="field">
              <span>Arrive by (optional)</span>
              <input type="time" value={arriveBy} onChange={(e) => setArriveBy(e.target.value)} />
            </label>
          </div>
          <button className="btn btn-primary" onClick={search}
            disabled={searching || !origin || !destination || origin.id === destination.id}>
            {searching ? "Searching…" : "Search"}
          </button>
        </section>

        {error && <p className="card error-card">{error}</p>}

        {result && (
          <>
            <SectionTitle>Connections</SectionTitle>
            <p className="fineprint">{result.ranking}.</p>
            {result.trips.length === 0 && <div className="card muted">No connection found.</div>}
            {planned.map((a) => (
              <ConnectionCard key={a.id} alt={a} deadline={result.deadline} tag={a.recommended ? "Our advice" : undefined}
                highlight={a.recommended} onOpen={() => push({ name: "connection", id: a.id })}>
                {notes.get(a.id) && <span className="plan-note">{notes.get(a.id)}</span>}
              </ConnectionCard>
            ))}
          </>
        )}
      </div>
    </>
  );
}
