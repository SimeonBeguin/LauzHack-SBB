// "Why and how long?": everything a curious traveller may want, one tap away
// from the main screen: the reopening estimate and SBB's internal information.
import { useStore } from "../store";
import { hhmm } from "../lib/format";
import HowLongCard from "../components/HowLongCard";
import { Header, Icon } from "../components/ui";

export default function IncidentDetails() {
  const { status, back, clock } = useStore();
  if (!status) return null;
  const d = status.details;

  return (
    <>
      <Header title="About this disruption" subtitle={status.title} onBack={back} />
      <div className="content">
        <section className="card detail">
          <h3>What is happening</h3>
          <p>{d?.summary ?? status.reason}</p>
          <p className="muted small">Since {hhmm(status.started_at)} · last SBB update {hhmm(status.last_update)}</p>
        </section>

        <HowLongCard status={status} now={clock} />

        {d && (
          <>
            {d.recommendation && (
              <section className="card detail">
                <h3>SBB recommends</h3>
                <p>{d.recommendation}</p>
              </section>
            )}
            {d.ticket_rules && (
              <section className="card detail">
                <h3><Icon name="ticket" size={16} /> Your ticket</h3>
                <p>{d.ticket_rules}</p>
              </section>
            )}
            {d.replacement_bus.length > 0 && (
              <section className="card detail">
                <h3>Replacement buses</h3>
                <ul>{d.replacement_bus.map((x) => <li key={x}>{x}</li>)}</ul>
              </section>
            )}
            {d.cancelled_trains.length > 0 && (
              <section className="card detail">
                <h3>Cancelled trains</h3>
                <ul>{d.cancelled_trains.map((x) => <li key={x}>{x}</li>)}</ul>
              </section>
            )}
            <p className="fineprint"><Icon name="info" size={14} /> Source: {d.source}.</p>
          </>
        )}
      </div>
    </>
  );
}
