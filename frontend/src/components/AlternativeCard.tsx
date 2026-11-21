import { useState } from "react";
import type { Alternative } from "../types";
import { hhmm, minutesBetween } from "../lib/format";
import { CertaintyBadge, Chip, Icon, LegBar } from "./ui";

const MODE_LABEL: Record<string, string> = {
  train: "Train", bus: "Bus", replacement_bus: "Replacement bus", walk: "Walk", tram: "Tram", wait: "Wait",
};

export function arrivalLabel(a: Alternative): string {
  return a.arrival_latest ? `${hhmm(a.arrival)}–${hhmm(a.arrival_latest)}` : hhmm(a.arrival);
}

export default function AlternativeCard({ alternative: a }: { alternative: Alternative }) {
  const [open, setOpen] = useState(false);
  const disabled = !!a.disabled_reason;
  const firstMoving = a.legs.find((l) => l.mode !== "wait") ?? a.legs[0];
  const transfers = a.legs.slice(1).map((l, i) => minutesBetween(a.legs[i].arrival, l.departure)).filter((m) => m > 0);

  return (
    <article className={`card alt-card ${disabled ? "disabled" : ""} ${a.recommended ? "recommended" : ""}`}>
      <button className="alt-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="alt-top">
          <div>
            {a.recommended && <div className="eyebrow red"><Icon name="star" size={12} /> Our advice</div>}
            <h3>{a.title ?? `Arrive at ${a.final_stop.name}`}</h3>
            <div className="muted small">{a.subtitle}</div>
          </div>
          <div className={`alt-time ${a.arrival_latest ? "range" : ""}`}>{arrivalLabel(a)}</div>
        </div>
        <LegBar legs={a.legs} />
        <div className="alt-row muted small">
          <span>{hhmm(firstMoving?.departure)} {firstMoving?.from_stop.name}</span>
          <span>
            {a.transfers === 0 ? "Direct" : `${a.transfers} transfer${a.transfers > 1 ? "s" : ""}`}
            {transfers.length > 0 && ` · min. ${Math.min(...transfers)} min`}
          </span>
        </div>
      </button>

      <div className="chips">
        <CertaintyBadge certainty={a.certainty} reason={a.certainty_reason} />
        {a.ticket_valid != null && (
          <Chip tone={a.ticket_valid ? "ok" : "warn"}>
            <Icon name="ticket" size={13} /> {a.ticket_valid ? "Ticket valid" : "Extra ticket needed"}
          </Chip>
        )}
        {a.warnings?.map((w) => <Chip key={w} tone="warn">{w}</Chip>)}
      </div>

      {disabled && <div className="disabled-reason">⊘ {a.disabled_reason}</div>}

      {open && (
        <ol className="legs">
          {a.legs.map((l, i) => (
            <li key={i} className={`leg leg-${l.mode}`}>
              <span className="leg-time">{hhmm(l.departure)}</span>
              <span className="leg-body">
                <strong>{l.mode === "wait" ? `Wait in ${l.from_stop.name}` : `${l.line ?? MODE_LABEL[l.mode] ?? l.mode} to ${l.to_stop.name}`}</strong>
                <span className="muted small">
                  {MODE_LABEL[l.mode] ?? l.mode} · {hhmm(l.departure)}–{hhmm(l.arrival)}
                  {l.road_delay_minutes ? ` · road traffic +${l.road_delay_minutes} min` : ""}
                </span>
              </span>
            </li>
          ))}
          {a.ticket_hint && <li className="leg-note muted small"><Icon name="ticket" size={13} /> {a.ticket_hint}</li>}
        </ol>
      )}
    </article>
  );
}
