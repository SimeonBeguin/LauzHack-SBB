// Opened from a commuter notification. One statement, one recommended action,
// one alternative. The "why" (reasons, trains on the line) is folded away.
// Everything comes from the alert computed by the backend watcher.
import { useStore } from "../store";
import { hhmm } from "../lib/format";
import { chanceLabel } from "../lib/chance";
import { ChanceBadge, ConnectionCard, Header, Icon, LineBadge, SectionTitle } from "../components/ui";
import AdviceCard from "../components/AdviceCard";
import BookingAlertScreen from "./BookingAlert";

const STATE_LABEL = { stuck: "Stopped", cancelled: "Cancelled", at_risk: "May be affected", ok: "Running" };

export default function CommuterAlert({ id }: { id: string }) {
  const { back, alerts, bookingAlerts, push } = useStore();
  const a = alerts.find((x) => x.notification.id === id);
  // opened from an OS notification of a booked trip
  if (!a && bookingAlerts.some((x) => x.notification.id === id)) return <BookingAlertScreen id={id} />;
  if (!a) return <Header title="Alert" onBack={back} />;
  const n = a.notification;
  const trip = a.trip;
  const resolved = n.kind === "resolved";
  const [advice, ...others] = a.options;
  const open = (altId: string) => push({ name: "connection", id: `alert:${n.id}:${altId}` });

  return (
    <>
      <Header title="Alert" onBack={back} />
      <div className="content overlap">
        <section className="card summary">
          <h2 className="summary-title">{trip.origin_name} <span className="arrow">→</span> {trip.destination_name}</h2>
          <div className={`timeline ${resolved ? "" : "cancelled"}`}>
            <LineBadge line={trip.line ?? "Train"} mode="train" />
            <strong>{hhmm(a.planned_departure)}</strong>
            <span className="tl-track" aria-hidden="true" />
            <strong>{hhmm(a.planned_arrival)}</strong>
          </div>
          <p className="summary-sub">Your regular trip · alert at {hhmm(n.created_at)}</p>
        </section>
        <section className={`card status-card ${resolved ? "ok" : ""}`}>
          <Icon name={resolved ? "check" : "alert"} size={26} />
          <div>
            <strong>{a.headline}</strong>
            <p>{n.body}</p>
            {n.probability != null && (
              <div className="status-chance">
                <span className="muted small">Chance your {hhmm(a.planned_departure)} runs normally</span>
                <ChanceBadge label={chanceLabel(1 - n.probability)} />
              </div>
            )}
          </div>
        </section>

        {advice && (
          <>
            <h2 className="section-title">Our advice</h2>
            <AdviceCard alt={advice} deadline={null} onOpen={() => open(advice.id)} />
          </>
        )}
        {others.length > 0 && (
          <>
            <SectionTitle>Other options</SectionTitle>
            {others.map((o) => <ConnectionCard key={o.id} alt={o} deadline={null} onOpen={() => open(o.id)} />)}
          </>
        )}

        <details className="card why">
          <summary>Why are we telling you this? <Icon name="down" size={16} /></summary>
          <ul className="reasons">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          {a.line.length > 0 && <h3>Trains on your line</h3>}
          <ol className="line-timeline">
            {a.line.map((tr) => (
              <li key={tr.departure + tr.line} className={`lt lt-${tr.state} ${tr.yours ? "yours" : ""}`}>
                <span className="lt-time">{hhmm(tr.departure)}</span>
                <span className="lt-dot" aria-hidden="true" />
                <span className="lt-body">
                  <strong>{tr.line ?? "Train"}{tr.yours ? " (your train)" : ""}</strong>
                  <span className="muted small">{STATE_LABEL[tr.state]}{tr.note ? `, ${tr.note.charAt(0).toLowerCase()}${tr.note.slice(1)}` : ""}</span>
                </span>
              </li>
            ))}
          </ol>
        </details>
      </div>
    </>
  );
}
