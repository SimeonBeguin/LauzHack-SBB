// The official SBB reopening time is the headline. Our statistics only add a
// margin around it ("plan until ...") and never replace it.
import { useState } from "react";
import type { DisruptionStatus, ProbabilityPoint, ReopeningEstimate } from "../types";
import { hhmm, pct } from "../lib/format";
import { Icon } from "./ui";

const RELIABILITY: Record<string, string> = { good: "good", fair: "fair", low: "low" };

function pointAt(points: ProbabilityPoint[], iso: string | null | undefined) {
  if (!iso) return undefined;
  return points.find((p) => p.before === iso);
}

/** Cumulative chance that the line has reopened, from now to the last point. */
function ProbabilityChart({ estimate, now }: { estimate: ReopeningEstimate; now: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const pts = estimate.probabilities ?? [];
  if (pts.length < 2) return null;

  const W = 320, H = 112, L = 8, R = 8, T = 22, B = 24;
  const t0 = new Date(now).getTime();
  const t1 = new Date(pts[pts.length - 1].before).getTime();
  const x = (iso: string) => L + ((new Date(iso).getTime() - t0) / (t1 - t0)) * (W - L - R);
  const y = (p: number) => T + (1 - p) * (H - T - B);

  const line = [[x(now), y(0)], ...pts.map((p) => [x(p.before), y(p.p)])];
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
        aria-label={`Chance the line has reopened: ${pts.map((p) => `${pct(p.p)} before ${hhmm(p.before)}`).join(", ")}`}>
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
          <g key={p.before} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}
            onClick={() => setHover(hover === i ? null : i)}>
            <circle cx={x(p.before)} cy={y(p.p)} r={14} fill="transparent" />
            <circle cx={x(p.before)} cy={y(p.p)} r={hover === i ? 5.5 : 4} className="chart-dot" />
            {(labelled.has(p.before) || hover === i) && (
              <text x={x(p.before) + (p.before === official ? 7 : 0)} y={y(p.p) - 9}
                textAnchor={i === pts.length - 1 ? "end" : p.before === official ? "start" : "middle"} className="chart-value">
                {pct(p.p)}
              </text>
            )}
          </g>
        ))}
      </svg>
      <div className="chart-caption">
        {hover != null
          ? <>{pct(pts[hover].p)} chance the line has reopened before {hhmm(pts[hover].before)}</>
          : <>Chance the line has reopened, by time of day</>}
      </div>
    </div>
  );
}

export default function EstimateCard({ status, now }: { status: DisruptionStatus; now: string }) {
  const e = status.estimate;

  if (status.kind === "resolved") {
    return (
      <section className="card estimate resolved">
        <div className="estimate-head">
          <Icon name="check" size={28} className="ok-icon" />
          <div>
            <div className="estimate-official">Line reopened at {hhmm(e.official_end)}</div>
            <div className="muted">{e.explanation}</div>
          </div>
        </div>
      </section>
    );
  }

  const pts = e.probabilities ?? [];
  const atOfficial = pointAt(pts, e.official_end);
  const atMargin = pointAt(pts, e.margin_until);

  return (
    <section className="card estimate">
      <div className="estimate-row">
        <span className="muted">Line reopening</span>
        <span className="muted">Updated at {hhmm(status.last_update)}</span>
      </div>
      <div className="estimate-official">
        SBB announces <strong>{e.official_label ?? ""} {hhmm(e.official_end)}</strong>
      </div>
      {e.margin_until && (
        <div className="estimate-margin">Plan a margin until <strong>{hhmm(e.margin_until)}</strong></div>
      )}

      <ProbabilityChart estimate={e} now={now} />

      {(atOfficial || atMargin) && (
        <p className="estimate-text">
          {atOfficial && <><strong>{pct(atOfficial.p)}</strong> chance the line reopens before {hhmm(atOfficial.before)}</>}
          {atOfficial && atMargin && ", "}
          {atMargin && <><strong>{pct(atMargin.p)}</strong> before {hhmm(atMargin.before)}.</>}
        </p>
      )}
      <p className="fineprint">
        <Icon name="info" size={14} /> Estimate, not a guarantee. {e.explanation}.
        {e.reliability && <> Reliability: {RELIABILITY[e.reliability]}.</>}
      </p>
    </section>
  );
}
