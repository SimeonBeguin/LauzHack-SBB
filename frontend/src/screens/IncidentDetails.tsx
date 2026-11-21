// "More details": internal SBB information (KULT ticker), shown on demand only.
import { useStore } from "../store";
import { hhmm } from "../lib/format";
import { Header, Icon } from "../components/ui";

export default function IncidentDetails() {
  const { status, back } = useStore();
  const d = status?.details;

  return (
    <>
      <Header title="Incident details" subtitle={status?.title} onBack={back} />
      <div className="content">
        {!d && <div className="card muted">No details available yet.</div>}
        {d && (
          <>
            <div className="source-badge"><Icon name="info" size={14} /> {d.source}</div>
            <section className="card detail">
              <h3>What is happening</h3>
              <p>{d.summary}</p>
              <p className="muted small">Section: {status?.affected_section} · since {hhmm(status?.started_at)}</p>
            </section>
            {d.cancelled_trains.length > 0 && (
              <section className="card detail">
                <h3>Cancelled and changed trains</h3>
                <ul>{d.cancelled_trains.map((x) => <li key={x}>{x}</li>)}</ul>
              </section>
            )}
            <section className="card detail">
              <h3>Replacement buses</h3>
              {d.replacement_bus.length ? <ul>{d.replacement_bus.map((x) => <li key={x}>{x}</li>)}</ul>
                : <p className="muted">Being organised. We will update this page.</p>}
            </section>
            {d.recommendation && (
              <section className="card detail">
                <h3>SBB travel recommendation</h3>
                <p>{d.recommendation}</p>
              </section>
            )}
            {d.ticket_rules && (
              <section className="card detail">
                <h3><Icon name="ticket" size={16} /> Ticket validity</h3>
                <p>{d.ticket_rules}</p>
              </section>
            )}
            <p className="fineprint">
              <Icon name="info" size={14} /> SBB staff get this information about 3 minutes after an incident.
              The public ticker follows about 39 minutes later (median, 2024–2026).
            </p>
          </>
        )}
      </div>
    </>
  );
}
