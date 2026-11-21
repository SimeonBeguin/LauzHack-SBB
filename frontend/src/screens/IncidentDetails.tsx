// "Why and how long?": everything a curious traveller may want, one tap away
// from the main screen: the reopening estimate and SBB's internal information.
import { useStore } from "../store";
import { hhmm } from "../lib/format";
import HowLongCard from "../components/HowLongCard";
import { Header, Icon } from "../components/ui";

function Section({ title, icon, items }: { title: string; icon?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <section className="card detail">
      <h3>{icon && <Icon name={icon} size={18} />}{title}</h3>
      {items.length === 1 ? <p>{items[0]}</p> : <ul>{items.map((x) => <li key={x}>{x}</li>)}</ul>}
    </section>
  );
}

export default function IncidentDetails() {
  const { status, details: d, back, clock } = useStore();
  if (!status) return <Header title="Disruption" onBack={back} />;

  return (
    <>
      <Header title="Disruption" onBack={back} />
      <div className="content overlap">
        <section className="card summary">
          <h2 className="summary-title">{status.title}</h2>
          <p>{d?.operating_concept ?? status.reason}</p>
          <p className="summary-sub">Since {hhmm(status.started_at)} · last SBB update {hhmm(status.last_update)}</p>
        </section>

        <HowLongCard status={status} now={clock} />

        {d?.found && (
          <>
            <Section title="SBB recommends" items={d.travel_recommendations} />
            <Section title="Your ticket" icon="ticket" items={d.ticket_goodwill} />
            <Section title="Replacement buses" icon="bus" items={d.replacement_buses} />
            <Section title="Cancelled trains" icon="train" items={d.cancelled_or_diverted_trains} />
            <p className="fineprint">
              <Icon name="info" size={14} /> Source: SBB operations (internal ticker)
              {d.internal_lead_minutes ? `, known ${d.internal_lead_minutes} min before the public ticker` : ""}.
            </p>
          </>
        )}
      </div>
    </>
  );
}
