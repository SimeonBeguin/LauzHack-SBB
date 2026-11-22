// One connection, step by step, laid out like the SBB "Connection" screen.
// Prevention: the reliability gauge of the trip, one line per bus leg that is
// often slowed by traffic, "Tight change" on risky changes (idea 3), and the
// delay we expect for each bus from the traffic ahead (idea 4).
import { Fragment, useEffect, useState } from "react";
import { getBusDelay } from "../api/client";
import { useStore } from "../store";
import type { Alternative, BusDelayForecast, Leg, LegReliability, TransferRisk } from "../types";
import { durationLabel, hhmm, minutesBetween } from "../lib/format";
import { gaugeOf, reasonFor } from "../lib/chance";
import { forecastText, usefulForecast } from "../lib/prevention";
import { ChanceBadge, CircleButton, Header, Icon, labelFor, LineBadge, PillRow, TimeLine, tripMinutes } from "../components/ui";

function findAlt(all: Alternative[], id: string) {
  return all.find((a) => a.id === id);
}

const isBus = (l: Pick<Leg, "mode">) => l.mode === "bus" || l.mode === "replacement_bus";
const sameMinute = (a: string, b: string) => Math.abs(new Date(a).getTime() - new Date(b).getTime()) < 60_000;

function LegCard({ leg, gauge, forecast }: { leg: Leg; gauge?: LegReliability; forecast?: BusDelayForecast }) {
  const kind = leg.mode === "replacement_bus" ? "Replacement bus" : leg.mode === "bus" ? "Bus" : "Train";
  const risky = isBus(leg) && gauge && gauge.level !== "good" && gauge.reason;
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
          {risky && <span className="leg-warn">{gauge!.reason}</span>}
          {usefulForecast(forecast) && (
            <span className="leg-forecast">
              <span>SBB shows: {forecast.official_delay_minutes ? `+${forecast.official_delay_minutes} min` : "on time"} · <b>We expect: +{forecast.predicted_delay_minutes} min</b></span>
              <span className="muted small">{forecastText(forecast)}</span>
            </span>
          )}
        </span>

        <strong className="leg-t">{hhmm(leg.arrival)}</strong>
        <span className="leg-dot filled" />
        <span className="leg-stop light">{leg.to_stop.name}</span>
      </div>
    </section>
  );
}

/** Idea 4: forecast every bus leg of the connection (with the presenter's demo jam). */
function useBusForecasts(legs: Leg[], jam: number | null): Record<number, BusDelayForecast> {
  const [out, setOut] = useState<Record<number, BusDelayForecast>>({});
  const key = legs.map((l) => `${l.mode}${l.from_stop.id}${l.departure}`).join("|");
  useEffect(() => {
    let alive = true;
    setOut({});
    legs.forEach((leg, i) => {
      if (!isBus(leg) || leg.mode === "replacement_bus") return;
      getBusDelay(leg.from_stop.id, leg.to_stop.id, leg.departure, jam)
        .then((r) => {
          const f = r.forecasts.find((x) => x.from_stop.id === leg.from_stop.id) ?? r.forecasts[0];
          if (alive && f) setOut((o) => ({ ...o, [i]: f }));
        })
        .catch(() => { /* no forecast: show nothing */ });
    });
    return () => { alive = false; };
  }, [key, jam]); // eslint-disable-line react-hooks/exhaustive-deps
  return out;
}

export default function ConnectionDetail({ id }: { id: string }) {
  const { alternatives, alerts, bookingAlerts, planned, back, status, prefs, showToast, jam } = useStore();
  const [saved, setSaved] = useState(false);
  // "alert:<notification id>:<alternative id>": an option of a commuter alert
  // "booking:<notification id>:<alternative id>": an option of a booked-trip alert
  // "plan-<k>": a trip of the "Plan a trip" search
  const [prefix, alertId, altId] = id.includes(":") ? id.split(":") : [];
  const alert = prefix === "alert" ? alerts.find((x) => x.notification.id === alertId) : undefined;
  const booking = prefix === "booking" ? bookingAlerts.find((x) => x.notification.id === alertId) : undefined;
  const a = alert ? alert.options.find((o) => o.id === altId)
    : booking ? booking.options.find((o) => o.id === altId)
    : planned.find((p) => p.id === id)
      ?? (alternatives ? findAlt(Object.values(alternatives.by_category).flat(), id) : undefined);
  // walks between two rides are shown in the "Change" row, not as a leg card
  const rides = a?.legs.filter((l) => l.mode !== "wait" && l.mode !== "walk") ?? [];
  const forecasts = useBusForecasts(rides, jam);
  if (!a) return <Header title="Connection" onBack={back} />;

  const names = alert ? alert.trip : booking ? booking.booking : null;
  const j = names
    ? { origin: { name: names.origin_name ?? "" }, destination: { name: names.destination_name ?? "" } }
    : status?.journey;
  const wait = a.legs.find((l) => l.mode === "wait");
  const gauge = gaugeOf(a);
  const legGauge = (leg: Leg) => gauge?.legs.find((g) => g.from_stop.id === leg.from_stop.id && sameMinute(g.departure, leg.departure));
  const changeRisk = (leg: Leg): TransferRisk | undefined => gauge?.transfers.find((t) => sameMinute(t.departure, leg.departure));
  const reason = reasonFor(a);

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
          {reason && <span className="muted">{reason}</span>}
        </section>

        <section className="card place-card"><strong>{a.legs[0].from_stop.name}</strong></section>

        {wait && (
          <PillRow lead={<span className="pill-min">{minutesBetween(wait.departure, wait.arrival)}'</span>} icon="history">
            Wait until the line reopens
          </PillRow>
        )}

        {rides.map((leg, i) => {
          const risk = i > 0 ? changeRisk(leg) : undefined;
          const tight = risk && risk.level !== "good";
          return (
            <Fragment key={i}>
              {i > 0 && (
                <PillRow lead={<span className="pill-min">{minutesBetween(rides[i - 1].arrival, leg.departure)}'</span>} icon="walk">
                  Change
                  {tight && <span className={`pill-sub change-${risk!.level}`}>Tight change: the {rides[i - 1].mode.includes("bus") ? "bus" : "train"} before is often late</span>}
                </PillRow>
              )}
              <LegCard leg={leg} gauge={legGauge(leg)} forecast={forecasts[i]} />
            </Fragment>
          );
        })}

        {a.distance_to_destination_km > 0 && (
          <PillRow icon="walk">{a.distance_to_destination_km} km to {j?.destination.name ?? "your destination"}</PillRow>
        )}
        {a.ticket_hint && <p className="ticket-line"><Icon name="ticket" size={18} /> {a.ticket_hint}</p>}
        <button className="cta" onClick={() => { setSaved(true); showToast("Saved. We'll tell you if anything changes."); }}>
          {a.ticket_valid === false ? "Tickets for the last part" : "Your ticket is valid · Save"}
        </button>
      </div>
    </>
  );
}
