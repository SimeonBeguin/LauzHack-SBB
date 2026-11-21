// Opened from a commuter notification. One statement, one recommended action,
// one alternative. The "why" (reasons, trains on the line) is folded away.
import { useStore } from "../store";
import { COMMUTER_ALERTS, COMMUTER_TRIP } from "../mocks/scenario";
import { hhmm } from "../lib/format";
import { chanceLabel } from "../lib/chance";
import { CertaintyBadge, ChanceBadge, Header, Icon, LineBadge } from "../components/ui";

const STATE_LABEL = { stuck: "Stopped", cancelled: "Cancelled", at_risk: "May be affected", ok: "Running" };

export default function CommuterAlert({ index }: { index: number }) {
  const { back } = useStore();
  const a = COMMUTER_ALERTS[index];
  const n = a.notification;
  const trip = COMMUTER_TRIP;
  const resolved = n.kind === "resolved";
  const [advice, ...others] = a.options;

  return (
    <>
      <Header title="Alert" onBack={back} />
      <div className="content overlap">
        <section className="card summary">
          <h2 className="summary-title">{trip.origin_name} <span className="arrow">→</span> {trip.destination_name}</h2>
          <div className={`timeline ${resolved ? "" : "cancelled"}`}>
            <LineBadge line={trip.line ?? "Train"} mode="train" />
            <strong>{trip.departure_time}</strong>
            <span className="tl-track" aria-hidden="true" />
            <strong>{trip.arrival_time}</strong>
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
                <span className="muted small">Chance your {trip.departure_time} runs normally</span>
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
              <span className="muted small">{advice.detail}</span>
            </div>
            <CertaintyBadge certainty={advice.certainty} />
            <button className="btn btn-primary">Show connection</button>
          </section>
        )}

        {others.map((o) => (
          <section key={o.title} className="card option-plain">
            <div>
              <strong>{o.title}</strong>
              <div className="muted small">{hhmm(o.departure)} → {hhmm(o.arrival)} · {o.detail}</div>
            </div>
            <CertaintyBadge certainty={o.certainty} />
          </section>
        ))}

        {a.footer && <section className="card status-card ok"><Icon name="check" size={26} /><div><strong>{a.footer}</strong></div></section>}

        <details className="card why">
          <summary>Why are we telling you this? <Icon name="down" size={16} /></summary>
          <ul className="reasons">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
          <h3>Trains on your line</h3>
          <ol className="line-timeline">
            {a.line.map((tr) => (
              <li key={tr.time + tr.train} className={`lt lt-${tr.state} ${tr.yours ? "yours" : ""}`}>
                <span className="lt-time">{hhmm(tr.time)}</span>
                <span className="lt-dot" aria-hidden="true" />
                <span className="lt-body">
                  <strong>{tr.train}{tr.yours ? " (your train)" : ""}</strong>
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
