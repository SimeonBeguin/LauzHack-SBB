// Detailed reopening estimate. The official SBB time stays the headline; our
// statistics only add a margin and never replace it.
import { useState } from "react";
import type { DisruptionStatus, EndProbability, ReopeningEstimate } from "../types";
import { hhmm, pct } from "../lib/format";
import { inTen } from "../lib/chance";
import { Icon } from "./ui";

const RELIABILITY: Record<string, string> = { good: "good", fair: "fair", low: "low" };

function pointAt(points: EndProbability[], iso: string | null | undefined) {
  if (!iso) return undefined;
  return points.find((p) => p.time === iso);
}

/** Cumulative chance that the line has reopened, from now to the last point. */
function ProbabilityChart({ estimate, now }: { estimate: ReopeningEstimate; now: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = estimate.probabilities ?? [];
  if (pts.length < 2) return null;

  const W = 320, H = 112, L = 8, R = 8, T = 22, B = 24;
  const t0 = new Date(now).getTime();
  const t1 = new Date(pts[pts.length - 1].time).getTime();
  const x = (iso: string) => L + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - L - R);
  const y = (p: number) => T + (1 - p) * (H - T - B);

  const line = [[x(now), y(0)], ...pts.map((p) => [x(p.time), y(p.probability_ended)])];
  const linePath = line.map(([a, b], i) => `${i ? "L" : "M"}${a.toFixed(1)},${b.toFixed(1)}`).join(" ");
  const areaPath = `${linePath} L${line[line.length - 1][0].toFixed(1)},${y(0)} L${line[0][0].toFixed(1)},${y(0)} Z`;

  // Half-hour ticks between now and the end
  const ticks: string[] = [];
  const first = new Date(t0);
  first.setMinutes(first.getMinutes() < 30 ? 30 : 60, 0, 0);
  for (let t = first.getTime(); t <= t1; t += 30 * 60_000) ticks.push(new Date(t).toISOString());
  const labelled = new Set([estimate.official_end, estimate.margin_until]);
  const official = estimate.official_end && new Date(estimate.official_end).getTime() <= t1 ? estimate.official_end : null;

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img"
        aria-label={`Chance the line has reopened: ${pts.map((p) => `${pct(p.probability_ended)} before ${hhmm(p.time)}`).join(", ")}`}>
        <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} className="chart-axis" />
        {ticks.map((t) => (
          <g key={t}>
            <line x1={x(t)} x2={x(t)} y1={y(0)} y2={y(0) + 4} className="chart-axis" />
            <text x={x(t)} y={H - 6} className="chart-tick" textAnchor="middle">{hhmm(t)}</text>
          </g>
        ))}
        {official && (
          <g>
            <line x1={x(official)} x2={x(official)} y1={T - 10} y2={y(0)} className="chart-official" />
            <text x={x(official)} y={T - 13} className="chart-official-label" textAnchor="middle">SBB {hhmm(official)}</text>
          </g>
        )}
        <path d={areaPath} className="chart-area" />
        <path d={linePath} className="chart-line" />
        {pts.map((p, i) => (
          <g key={p.time} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}>
            <circle cx={x(p.time)} cy={y(p.probability_ended)} r={14} fill="transparent" />
            <circle cx={x(p.time)} cy={y(p.probability_ended)} r={hover === i ? 5.5 : 4} className="chart-dot" />
            {(labelled.has(p.time) || hover === i) && (
              <text x={x(p.time) + (p.time === official ? 7 : 0)} y={y(p.probability_ended) - 9}
                textAnchor={i === pts.length - 1 ? "end" : p.time === official ? "start" : "middle"} className="chart-value">
                {pct(p.probability_ended)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-caption">
        {hover != null
          ? <>{pct(pts[hover].probability_ended)} chance the line has reopened before {hhmm(pts[hover].time)}</>
          : <>Chance the line is open again, by time of day</>}
      </div>
    </div>
  );
}

/** Shown on the "Why and how long?" page only, for people who want to know more. */
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
  const pts = e.probabilities ?? [];
  const atOfficial = pointAt(pts, e.official_end);
  const atMargin = pointAt(pts, e.margin_until);

  return (
    <section className="card estimate">
      <h3>How long will it last?</h3>
      {e.official_end
        ? <p>SBB expects trains again <strong>{e.official_label} {hhmm(e.official_end)}</strong>.</p>
        : <p>SBB has not announced an end time yet.</p>}
      {atOfficial && atMargin && (
        <p>
          We looked at {e.similar_incidents_count} similar incidents. The line was open again
          by {hhmm(atOfficial.time)} in <strong>{inTen(atOfficial.probability_ended)}</strong> cases,
          and by {hhmm(atMargin.time)} in <strong>{inTen(atMargin.probability_ended)}</strong> cases.
        </p>
      )}
      {e.margin_until && <p className="estimate-margin">To be safe, count on {hhmm(e.margin_until)}.</p>}
      <ProbabilityChart estimate={e} now={now} />
      <p className="fineprint">
        <Icon name="info" size={14} /> This is an estimate, not a promise. SBB's time stays the official one.
        {e.reliability && <> Reliability of the estimate: {RELIABILITY[e.reliability]}.</>}
      </p>
    </section>
  );
}
