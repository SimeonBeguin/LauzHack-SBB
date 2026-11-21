// One connection, SBB timetable style: line pictograms, times, connection
// line, one chance badge. Tap to see each step.
import { useState } from "react";
import type { Alternative } from "../types";
import { hhmm } from "../lib/format";
import { ChanceBadge, ConnectionLine, Icon, labelFor, LineBadge, LineBadges } from "./ui";

export default function AlternativeCard({ alternative: a, deadline }: { alternative: Alternative; deadline: string | null }) {
  const [open, setOpen] = useState(false);
  const disabled = !!a.disabled_reason;

  return (
    <article className={`card alt-card ${disabled ? "disabled" : ""} ${a.recommended ? "recommended" : ""}`}>
      <button className="alt-main" onClick={() => setOpen(!open)} aria-expanded={open}>
        <div className="alt-top">
          <LineBadges legs={a.legs} />
          {a.recommended && <span className="advice-tag">Our advice</span>}
        </div>
        <h3>{a.title}</h3>
        <ConnectionLine alt={a} />
      </button>

      {disabled ? (
        <div className="disabled-reason">Hidden from your options: {a.disabled_reason}</div>
      ) : (
        <div className="alt-foot">
          <ChanceBadge label={labelFor(a)} suffix={deadline ? `by ${hhmm(deadline)}` : undefined} />
          {a.warnings?.[0] && <span className="muted small">{a.warnings[0]}</span>}
        </div>
      )}

      {open && (
        <ol className="legs">
          {a.legs.map((l, i) => (
            <li key={i} className={`leg leg-${l.mode}`}>
              <span className="leg-time">{hhmm(l.departure)}</span>
              <span className="leg-body">
                {l.mode === "wait"
                  ? <strong>Wait in {l.from_stop.name} until the line reopens</strong>
                  : <strong><LineBadge line={l.line} mode={l.mode} /> to {l.to_stop.name}</strong>}
                <span className="muted small">
                  {l.mode === "wait" ? `Earliest train ${hhmm(l.arrival)}` : `${l.from_stop.name} ${hhmm(l.departure)} → ${l.to_stop.name} ${hhmm(l.arrival)}`}
                  {l.road_delay_minutes ? ` · traffic +${l.road_delay_minutes} min` : ""}
                </span>
              </span>
            </li>
          ))}
          {a.ticket_hint && <li className="leg-note muted small"><Icon name="ticket" size={14} /> {a.ticket_hint}</li>}
        </ol>
      )}
    </article>
  );
}
