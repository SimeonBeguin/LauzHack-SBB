// One connection, step by step, laid out like the SBB "Connection" screen.
import { Fragment, useState } from "react";
import { useStore } from "../store";
import type { Alternative, Leg } from "../types";
import { durationLabel, hhmm, minutesBetween } from "../lib/format";
import { ChanceBadge, CircleButton, Header, Icon, labelFor, LineBadge, PillRow, TimeLine, tripMinutes } from "../components/ui";

function findAlt(all: Alternative[], id: string) {
  return all.find((a) => a.id === id);
}

function LegCard({ leg }: { leg: Leg }) {
  const kind = leg.mode === "replacement_bus" ? "Replacement bus" : leg.mode === "bus" ? "Bus" : "Train";
  return (
    <section className="card leg-card">
      <div className="leg-grid">
        <strong className="leg-t">{hhmm(leg.departure)}</strong>
        <span className="leg-dot filled" />
        <strong className="leg-stop">{leg.from_stop.name}</strong>

        <span />
        <span className="leg-rail" />
        <span className="leg-info">
          <span className="leg-line">
            <Icon name={leg.mode.includes("bus") ? "bus" : "train"} size={22} />
            <LineBadge line={leg.line} mode={leg.mode} />
          </span>
          <span>{kind} direction {leg.to_stop.name}</span>
          {leg.road_delay_minutes ? <span className="muted">Road traffic: +{leg.road_delay_minutes} min possible</span> : null}
        </span>

        <strong className="leg-t">{hhmm(leg.arrival)}</strong>
        <span className="leg-dot filled" />
        <span className="leg-stop light">{leg.to_stop.name}</span>
      </div>
    </section>
  );
}

export default function ConnectionDetail({ id }: { id: string }) {
  const { alternatives, back, status, prefs, showToast } = useStore();
  const [saved, setSaved] = useState(false);
  const a = alternatives && findAlt(Object.values(alternatives.by_category).flat(), id);
  if (!a) return <Header title="Connection" onBack={back} />;

  const j = status?.journey;
  const rides = a.legs.filter((l) => l.mode !== "wait");
  const wait = a.legs.find((l) => l.mode === "wait");

  return (
    <>
      <Header title="Connection" onBack={back} />
      <div className="content overlap with-cta">
        <section className="card summary with-circles">
          <h2 className="summary-title">{j?.origin.name ?? a.legs[0].from_stop.name} <span className="arrow">→</span> {a.final_stop.name}</h2>
          <TimeLine legs={a.legs} arrival={a.arrival_latest ? `${hhmm(a.arrival)}+` : undefined} arrivalLate={!!a.arrival_latest} />
          <p className="summary-sub">Today, {durationLabel(tripMinutes(a))}</p>
        </section>
        <div className="circle-row">
          <CircleButton icon="star" label="Save" active={saved} onClick={() => setSaved(!saved)} />
          <CircleButton icon="map" label="Map" />
          <span className="grow" />
          <CircleButton icon="more" label="More" />
        </div>

        <section className="card chance-card">
          <ChanceBadge big label={labelFor(a)} suffix={prefs.deadline ? `to arrive by ${hhmm(prefs.deadline)}` : undefined} />
          {a.certainty_reason && <span className="muted">{a.certainty_reason}.</span>}
        </section>

        <section className="card place-card"><strong>{a.legs[0].from_stop.name}</strong></section>

        {wait && (
          <PillRow lead={<span className="pill-min">{minutesBetween(wait.departure, wait.arrival)}'</span>} icon="history">
            Wait until the line reopens
          </PillRow>
        )}

        {rides.map((leg, i) => (
          <Fragment key={i}>
            {i > 0 && (
              <PillRow lead={<span className="pill-min">{minutesBetween(rides[i - 1].arrival, leg.departure)}'</span>} icon="walk">
                Change
              </PillRow>
            )}
            <LegCard leg={leg} />
          </Fragment>
        ))}

        {a.distance_to_destination_km > 0 && (
          <PillRow icon="walk">{a.distance_to_destination_km} km to {j?.destination.name ?? "your destination"}</PillRow>
        )}
        {a.ticket_hint && <p className="ticket-line"><Icon name="ticket" size={18} /> {a.ticket_hint}</p>}
      </div>
      <button className="cta" onClick={() => { setSaved(true); showToast("Saved. We'll tell you if anything changes."); }}>
        {a.ticket_valid === false ? "Tickets for the last part" : "Your ticket is valid · Save"}
      </button>
    </>
  );
}
