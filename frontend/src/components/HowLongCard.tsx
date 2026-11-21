// "When will trains run again?" on the Details page. Made for anyone, not for
// statisticians: one time line (now, SBB's time, the most likely range) and a
// few "x in 10" answers. The official SBB time stays the headline; our
// statistics only add a margin and never replace it.
import type { DisruptionStatus, ReopeningEstimate } from "../types";
import { hhmm } from "../lib/format";
import { inTen } from "../lib/chance";
import { Icon } from "./ui";

const ms = (iso: string) => new Date(iso).getTime();

/** A single time line: now on the left, the most likely range shaded, SBB's time pinned. */
function TimeRange({ e, now }: { e: ReopeningEstimate; now: string }) {
  const from = e.likely_end_earliest, to = e.likely_end_latest;
  if (!from || !to) return null;
  const t0 = ms(now);
  const ends = [to, e.margin_until, e.official_end].filter(Boolean).map((x) => ms(x!));
  const t1 = Math.ceil((Math.max(...ends) + 20 * 60_000) / 1_800_000) * 1_800_000; // next half hour
  const W = 320, L = 10, R = 10, TRACK_Y = 40, TRACK_H = 14;
  const x = (t: number) => L + (Math.min(Math.max(t, t0), t1) - t0) / (t1 - t0) * (W - L - R);

  const hours: number[] = [];
  for (let t = Math.ceil(t0 / 3_600_000) * 3_600_000; t <= t1; t += 3_600_000) hours.push(t);
  const official = e.official_end && ms(e.official_end) > t0 ? ms(e.official_end) : null;
  const bandX = x(ms(from)), bandW = Math.max(6, x(ms(to)) - bandX);

  return (
    <div className="timerange">
      <svg viewBox={`0 0 ${W} 100`} width="100%" role="img"
        aria-label={`Trains most likely run again between ${hhmm(from)} and ${hhmm(to)}.` +
          (official ? ` SBB says ${hhmm(e.official_end)}.` : "")}>
        <text x={bandX + bandW / 2} y={TRACK_Y - 10} textAnchor="middle" className="tr-band-label">
          Most likely {hhmm(from)} – {hhmm(to)}
        </text>
        <rect x={L} y={TRACK_Y} width={W - L - R} height={TRACK_H} rx={TRACK_H / 2} className="tr-track" />
        <rect x={bandX} y={TRACK_Y} width={bandW} height={TRACK_H} rx={TRACK_H / 2} className="tr-band" />
        <circle cx={L + 3} cy={TRACK_Y + TRACK_H / 2} r={6} className="tr-now" />
        <text x={L} y={TRACK_Y + TRACK_H + 20} className="tr-now-label">Now</text>
        {official && (
          <g>
            <line x1={x(official)} x2={x(official)} y1={TRACK_Y - 4} y2={TRACK_Y + TRACK_H + 6} className="tr-sbb" />
            <text x={x(official)} y={TRACK_Y + TRACK_H + 20} textAnchor="middle" className="tr-sbb-label">
              SBB {hhmm(e.official_end)}
            </text>
          </g>
        )}
        {hours.map((t) => (
          <text key={t} x={x(t)} y={96} textAnchor="middle" className="tr-tick">{hhmm(new Date(t).toISOString())}</text>
        ))}
      </svg>
    </div>
  );
}

/** "Will trains run again by 19:12?" → ●●●●●●○○○○ 6 in 10. */
function ChanceRows({ e }: { e: ReopeningEstimate }) {
  const pts = e.probabilities ?? [];
  if (!pts.length) return null;
  return (
    <div className="chance-rows">
      <h4>Will trains run again by…</h4>
      {pts.map((p) => {
        const n = Math.min(10, Math.max(0, Math.round(p.probability_ended * 10)));
        return (
          <div key={p.time} className="chance-row">
            <span className="cr-time">{hhmm(p.time)}{p.time === e.official_end && <small> SBB</small>}</span>
            <span className="cr-dots" aria-hidden="true">
              {Array.from({ length: 10 }, (_, i) => <i key={i} className={i < n ? "on" : ""} />)}
            </span>
            <span className="cr-text">{inTen(p.probability_ended)}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function HowLongCard({ status, now }: { status: DisruptionStatus; now: string }) {
  const e = status.estimate;
  if (status.kind === "resolved") {
    return (
      <section className="card estimate">
        <h3>How long did it last?</h3>
        <p>The line reopened at <strong>{hhmm(e.official_end)}</strong>.</p>
      </section>
    );
  }
  const atOfficial = e.probabilities?.find((p) => p.time === e.official_end);

  return (
    <section className="card estimate">
      <h3>When will trains run again?</h3>
      {e.official_end
        ? <p>SBB expects trains again <strong>{e.official_label} {hhmm(e.official_end)}</strong>.</p>
        : <p>SBB has not announced an end time yet.</p>}
      {atOfficial && atOfficial.probability_ended < 0.5 && (
        <p>Often it takes longer: in similar cases, <strong>{Math.round((1 - atOfficial.probability_ended) * 10)} out of 10</strong> reopened later.</p>
      )}
      {e.margin_until && <p className="estimate-margin">To be safe, count on {hhmm(e.margin_until)}.</p>}
      <TimeRange e={e} now={now} />
      <ChanceRows e={e} />
      <p className="fineprint">
        <Icon name="info" size={14} /> {e.similar_incidents_count
          ? `Based on ${e.similar_incidents_count} similar past incidents. `
          : ""}An estimate, not a promise: SBB's time stays the official one.
      </p>
    </section>
  );
}
