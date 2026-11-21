// Prevention, idea 2: opened from a booked-trip notification. One statement,
// the changes of the trip (green / orange / red with the cause), our bus
// forecast next to what SBB shows (idea 4), one advice, and the "why" folded away.
import { useStore } from "../store";
import type { BusDelayForecast, ConnectionCheck } from "../types";
import { hhmm } from "../lib/format";
import { ConnectionCard, Header, Icon, SectionTitle, TimeLine } from "../components/ui";
import { forecastText, usefulForecast } from "../lib/prevention";

const CHECK_WORD: Record<ConnectionCheck["status"], string> = {
  ok: "Fine", at_risk: "Tight", broken: "You will probably miss it",
};

export function ChangeRow({ c }: { c: ConnectionCheck }) {
  return (
    <li className={`check-row check-${c.status}`}>
      <span className="check-dot" aria-hidden="true" />
      <span className="check-body">
        <strong>Change at {c.at_stop.name}</strong>
        <span className="check-word">{CHECK_WORD[c.status]}</span>
        {c.cause && <span className="muted small">{c.cause}</span>}
      </span>
      <span className="check-time">{hhmm(c.departure)}</span>
    </li>
  );
}

export function ForecastRow({ f }: { f: BusDelayForecast }) {
  return (
    <div className="leg-forecast">
      <span>Bus {f.line ?? ""} to {f.to_stop.name}</span>
      <span>SBB shows: {f.official_delay_minutes ? `+${f.official_delay_minutes} min` : "on time"} · <b>We expect: +{f.predicted_delay_minutes} min</b></span>
      <span className="muted small">{forecastText(f)}</span>
    </div>
  );
}

export default function BookingAlertScreen({ id }: { id: string }) {
  const { back, bookingAlerts, push } = useStore();
  const a = bookingAlerts.find((x) => x.notification.id === id);
  if (!a) return <Header title="Alert" onBack={back} />;
  const n = a.notification;
  const b = a.booking;
  const good = n.kind === "booking_back_to_normal";
  const forecasts = a.bus_forecasts.filter(usefulForecast);
  const [advice, ...others] = a.options;
  const open = (altId: string) => push({ name: "connection", id: `booking:${n.id}:${altId}` });

  return (
    <>
      <Header title="Alert" onBack={back} />
      <div className="content overlap">
        <section className="card summary">
          <h2 className="summary-title">{b.origin_name} <span className="arrow">→</span> {b.destination_name}</h2>
          {b.legs?.length ? <TimeLine legs={b.legs} /> : (
            <div className="timeline"><strong>{hhmm(b.departure)}</strong><span className="tl-track" /><strong>{hhmm(b.arrival)}</strong></div>
          )}
          <p className="summary-sub">Your booked trip · alert at {hhmm(n.created_at)}</p>
        </section>

        <section className={`card status-card ${good ? "ok" : ""}`}>
          <Icon name={good ? "check" : "alert"} size={26} />
          <div>
            <strong>{a.headline}</strong>
            <p>{n.body}</p>
          </div>
        </section>

        {(a.connections.length > 0 || forecasts.length > 0) && (
          <section className="card check-card">
            {a.connections.length > 0 && <ul className="check-list">{a.connections.map((c) => <ChangeRow key={c.departure + c.at_stop.id} c={c} />)}</ul>}
            {forecasts.map((f) => <ForecastRow key={f.planned_departure + (f.line ?? "")} f={f} />)}
          </section>
        )}

        {advice && (
          <>
            <SectionTitle>Our advice</SectionTitle>
            <ConnectionCard alt={advice} deadline={null} highlight onOpen={() => open(advice.id)} />
          </>
        )}
        {others.length > 0 && (
          <>
            <SectionTitle>Other options</SectionTitle>
            {others.slice(0, 2).map((o) => <ConnectionCard key={o.id} alt={o} deadline={null} onOpen={() => open(o.id)} />)}
          </>
        )}

        {a.ticket_note && <p className="ticket-line"><Icon name="ticket" size={18} /> {a.ticket_note}</p>}

        {a.reasons.length > 0 && (
          <details className="card why">
            <summary>Why are we telling you this? <Icon name="down" size={16} /></summary>
            <ul className="reasons">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          </details>
        )}
      </div>
    </>
  );
}
