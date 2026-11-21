// "Details": everything about the disruption, one tap away from "Need help":
// what happened, the latest SBB update, how long it may last (with chances in
// plain words) and SBB's internal information when we have it.
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
  const { status, details: d, situation, back, clock } = useStore();
  if (!status) return <Header title="Details" onBack={back} />;

  const resolved = status.kind === "resolved";
  const where = status.affected_section ?? situation?.section;
  const buses = d?.found && d.replacement_buses.length
    ? "Yes, see below"
    : situation?.replacement_bus ? "Yes, between the closed stations" : "Not yet";
  const change = status.changes?.[0];

  return (
    <>
      <Header title="Details" onBack={back} />
      <div className="content overlap">
        <section className="card facts-card">
          <h3>About the incident</h3>
          <dl className="facts">
            <dt>What</dt>
            <dd>{resolved ? "Trains are running again" : status.kind === "restriction" ? "Fewer trains" : "No trains"}</dd>
            {where && <><dt>Where</dt><dd>{where}</dd></>}
            {status.reason && <><dt>Cause</dt><dd>{status.reason}</dd></>}
            {status.started_at && <><dt>Since</dt><dd>{hhmm(status.started_at)}</dd></>}
            {!resolved && <><dt>Buses</dt><dd>{buses}</dd></>}
          </dl>
          <p className="muted small">
            Last SBB update {hhmm(status.last_update)}{change ? `: ${change}` : ""}
          </p>
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
