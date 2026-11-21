// Opened from a commuter notification. One statement, one recommended action,
// one alternative. The "why" (reasons, trains on the line) is folded away.
// Everything comes from the alert computed by the backend watcher.
import { useStore } from "../store";
import { hhmm } from "../lib/format";
import { chanceLabel } from "../lib/chance";
import { CertaintyBadge, ChanceBadge, Header, Icon, LineBadge } from "../components/ui";
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
  const detail = (o: typeof advice) =>
    o.uses_blocked_line ? "Only if the line reopens in time"
      : `${o.transfers === 0 ? "Direct" : `${o.transfers} change${o.transfers > 1 ? "s" : ""}`}, ${o.certainty_reason ?? ""}`;

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
          <section className="card advice">
            <div className="advice-eyebrow">Our advice</div>
            <h2 className="advice-title">{advice.title}</h2>
            <div className="advice-times">
              <strong>{hhmm(advice.departure)}</strong>
              <Icon name="arrow" size={18} className="muted" />
              <strong>{hhmm(advice.arrival)}</strong>
              <span className="muted small">{detail(advice)}</span>
            </div>
            <CertaintyBadge certainty={advice.certainty} />
            <button className="btn btn-primary" onClick={() => push({ name: "connection", id: `alert:${n.id}:${advice.id}` })}>
              Show connection
            </button>
          </section>
        )}

        {others.map((o) => (
          <section key={o.id} className="card option-plain">
            <div>
              <strong>{o.title}</strong>
              <div className="muted small">{hhmm(o.departure)} → {hhmm(o.arrival)} · {detail(o)}</div>
            </div>
            <CertaintyBadge certainty={o.certainty} />
          </section>
        ))}

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
