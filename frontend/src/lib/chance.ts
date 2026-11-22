// Turn probabilities into words a tired traveller understands at a glance.
// We never show a bare percentage on the main screens: a word, a colour and
// "x in 10" (natural frequencies are easier to read than percentages).
import type { Alternative, Certainty, EndProbability, ReliabilityLevel, TripReliability } from "../types";
import { minutesBetween } from "./format";

export type Tone = "good" | "ok" | "bad";

export interface ChanceLabel {
  word: string; tone: Tone; freq: string;
  /** the probability behind the word, in % (shown next to it) */
  percent: number | null;
}

const pct = (p: number) => Math.round(Math.min(1, Math.max(0, p)) * 100);

export function inTen(p: number): string {
  if (p < 0.05) return "less than 1 in 10";
  if (p > 0.95) return "more than 9 in 10";
  return `${Math.min(9, Math.max(1, Math.round(p * 10)))} in 10`;
}

export function chanceLabel(p: number): ChanceLabel {
  const freq = inTen(p);
  const percent = pct(p);
  if (p >= 0.9) return { word: "Almost certain", tone: "good", freq, percent };
  if (p >= 0.7) return { word: "Very likely", tone: "good", freq, percent };
  if (p >= 0.5) return { word: "Likely", tone: "ok", freq, percent };
  if (p >= 0.3) return { word: "Uncertain", tone: "ok", freq, percent };
  if (p >= 0.1) return { word: "Unlikely", tone: "bad", freq, percent };
  return { word: "Very unlikely", tone: "bad", freq, percent };
}

/** Chance an option runs as planned, by certainty (also the base of onTimeChance). */
const BASE: Record<Certainty, number> = { safe: 0.95, likely: 0.85, uncertain: 0.6 };

/** Without a deadline: how reliable the option is. */
export const RELIABILITY: Record<Certainty, ChanceLabel> = {
  safe: { word: "Reliable", tone: "good", freq: "", percent: pct(BASE.safe) },
  likely: { word: "Probably fine", tone: "ok", freq: "", percent: pct(BASE.likely) },
  uncertain: { word: "Uncertain", tone: "bad", freq: "", percent: pct(BASE.uncertain) },
};

/** Reliability gauge (Prevention, idea 3): the backend word with our colour. */
const LEVEL_TONE: Record<ReliabilityLevel, Tone> = { good: "good", fair: "ok", low: "bad" };
export function reliabilityLabel(r: TripReliability): ChanceLabel {
  const p = r.on_time_probability ?? 1 - r.probability_late_5min;
  return { word: r.label, tone: LEVEL_TONE[r.level], freq: "", percent: pct(p) };
}

/** The gauge applies to routes that run normally; "wait" options depend on the reopening instead. */
export function gaugeOf(a: Pick<Alternative, "reliability" | "uses_blocked_line">): TripReliability | null {
  return a.reliability && !a.uses_blocked_line ? a.reliability : null;
}

/** One short sentence on why an option is (un)reliable. */
export function reasonFor(a: Pick<Alternative, "reliability" | "uses_blocked_line" | "certainty_reason">): string | null {
  return gaugeOf(a)?.reason ?? a.certainty_reason ?? null;
}


/** Chance the line has reopened before `t`, interpolated on the estimate curve. */
export function reopenedBefore(points: EndProbability[], now: string, t: string): number {
  const pts = [{ time: now, probability_ended: 0 }, ...points];
  const at = new Date(t).getTime();
  if (at <= new Date(now).getTime()) return 0;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const ta = new Date(a.time).getTime(), tb = new Date(b.time).getTime();
    if (at <= tb) return a.probability_ended + ((at - ta) / (tb - ta)) * (b.probability_ended - a.probability_ended);
  }
  return pts[pts.length - 1].probability_ended;
}

/**
 * Chance this option gets the traveller there by `deadline`.
 * - Routes that use the blocked line depend on when it reopens.
 * - Other routes depend on their own reliability, and must arrive in time.
 * Uses the reopening curve of the backend estimate for routes through the blocked line.
 */
export function onTimeChance(a: Alternative, deadline: string, curve: EndProbability[], now: string): number {
  const base = BASE[a.certainty ?? "uncertain"];
  if (a.uses_blocked_line) {
    const ride = a.legs.find((l) => l.mode !== "wait");
    const rideMin = ride ? minutesBetween(ride.departure, ride.arrival) : 60;
    // Need the line open ~10 min before the last train that still arrives in time.
    const latestReopen = new Date(new Date(deadline).getTime() - (rideMin + 10) * 60_000).toISOString();
    return Math.min(base + 0.3, reopenedBefore(curve, now, latestReopen));
  }
  const slack = minutesBetween(a.arrival, deadline);
  if (slack < 0) return 0.02;
  const roadDelay = Math.max(0, ...a.legs.map((l) => l.road_delay_minutes ?? 0));
  if (roadDelay && slack < roadDelay) return base * 0.5;
  if (slack < 5) return base - 0.15;
  return base;
}
