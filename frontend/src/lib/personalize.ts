// "Personalize": three questions, then ONE best itinerary for this traveller.
//
// 1. Where can you get off?  -> how far from the destination the trip may end,
//                                and how the last bit is done (on foot / picked up)
// 2. What suits you best?    -> the weights of the formula below
// 3. You're travelling with… -> hard limits (no bus with a bike, step-free for
//                                reduced mobility) and the walking speed
//
// Every option gets a cost in "equivalent minutes"; the lowest wins:
//
//   cost = minutes until arrival at the final stop
//        + P_change x number of changes
//        + P_bus    x (1 if the trip uses a replacement bus)
//        + P_risk   x minutes of uncertainty
//
// The last bit from the final stop to the destination (on foot / picked up) is
// NOT added: question 1 only decides how far from the destination a trip may end.
//
// Uncertainty: waiting for the reopening = how much later than SBB's announced
// time our estimate expects it (median); replacement bus = 10 min (traffic);
// other routes = their usual road delay, if any.
import type {
  Alternative, AlternativesResponse, DisruptionStatus, Preferences, StopChoice, TradeOff, TravelWith,
} from "../types";
import { durationLabel, minutesBetween } from "./format";

export type { StopChoice, TradeOff, TravelWith };

export interface PersonalAnswers { stop: StopChoice; tradeOff: TradeOff; travelWith: TravelWith }

// ---------------------------------------------------------------------------
// Questions (UI texts)
// ---------------------------------------------------------------------------
export interface QuestionOption<T extends string> { value: T; label: string; hint?: string; icon: string }
export interface Question<K extends keyof PersonalAnswers> {
  key: K; title: string; options: QuestionOption<PersonalAnswers[K]>[];
}

export const WALK_MAX_KM = 2;
export const PICKUP_MAX_KM = 10;
const AT_DESTINATION_KM = 0.5; // same station area

export const QUESTIONS: [Question<"stop">, Question<"tradeOff">, Question<"travelWith">] = [
  {
    key: "stop",
    title: "Where can you get off?",
    options: [
      { value: "exact", label: "Right at my destination", icon: "target" },
      { value: "walk", label: "Close by, I'll walk the rest", hint: `Up to ${WALK_MAX_KM} km away`, icon: "walk" },
      { value: "pickup", label: "Further away, someone picks me up", hint: `Up to ${PICKUP_MAX_KM} km away`, icon: "car" },
    ],
  },
  {
    key: "tradeOff",
    title: "What suits you best?",
    options: [
      { value: "anything", label: "I accept anything", hint: "Changes, replacement buses: whatever is quickest", icon: "check-plain" },
      { value: "changes", label: "Changes yes, buses no", icon: "swap" },
      { value: "wait", label: "I'd rather wait", hint: "For the line to reopen", icon: "history" },
      { value: "simplest", label: "The simplest way", icon: "ring" },
    ],
  },
  {
    key: "travelWith",
    title: "You're travelling with…",
    options: [
      { value: "nothing", label: "Nothing special", icon: "user" },
      { value: "luggage", label: "Luggage / stroller", icon: "luggage" },
      { value: "bike", label: "A bike", icon: "bike" },
      { value: "reduced_mobility", label: "Reduced mobility", icon: "wheelchair" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Answers <-> preferences (the answers live in Preferences, so the backend
// search radius and the existing Preferences sheet stay consistent)
// ---------------------------------------------------------------------------
export function answersOf(p: Preferences): PersonalAnswers | null {
  if (!p.stop_choice || !p.trade_off || !p.travel_with) return null;
  return { stop: p.stop_choice, tradeOff: p.trade_off, travelWith: p.travel_with };
}

export function withAnswers(p: Preferences, a: PersonalAnswers): Preferences {
  return {
    ...p,
    stop_choice: a.stop,
    trade_off: a.tradeOff,
    travel_with: a.travelWith,
    // radius the backend searches arrival stops in
    destination_radius_km: a.stop === "exact" ? 0 : a.stop === "walk" ? WALK_MAX_KM : PICKUP_MAX_KM,
    accessible_only: a.travelWith === "reduced_mobility",
    luggage: a.travelWith === "luggage",
    stroller_bike: a.travelWith === "bike",
    few_transfers: a.tradeOff === "simplest" || a.tradeOff === "wait",
    // replacement buses are weighed by the formula (P_bus), not filtered out
    avoid_replacement_bus: false,
  };
}

/** After an edit in the Preferences sheet: keep question 3 in line with the ticked needs. */
export function syncAnswers(p: Preferences): Preferences {
  if (!answersOf(p)) return p;
  const travel_with: TravelWith = p.accessible_only ? "reduced_mobility"
    : p.stroller_bike ? "bike" : p.luggage ? "luggage" : "nothing";
  const stop_choice: StopChoice = p.destination_radius_km <= AT_DESTINATION_KM ? "exact"
    : p.stop_choice === "pickup" ? "pickup" : "walk";
  return { ...p, travel_with, stop_choice };
}

export function answersSummary(a: PersonalAnswers): string {
  const stop = { exact: "at my destination", walk: "walk the rest", pickup: "picked up nearby" }[a.stop];
  const trade = { anything: "anything goes", changes: "changes yes, buses no", wait: "rather wait", simplest: "simplest way" }[a.tradeOff];
  const travel = { nothing: "", luggage: "luggage", bike: "bike", reduced_mobility: "reduced mobility" }[a.travelWith];
  return [stop, trade, travel].filter(Boolean).join(" · ");
}

// ---------------------------------------------------------------------------
// The algorithm
// ---------------------------------------------------------------------------
/** Weights of question 2: P_change, P_bus, P_risk. */
export const TRADE_OFF_WEIGHTS: Record<TradeOff, { change: number; bus: number; risk: number }> = {
  anything: { change: 2, bus: 5, risk: 1 },
  changes: { change: 5, bus: 60, risk: 1 },
  wait: { change: 10, bus: 60, risk: 0.3 },
  simplest: { change: 20, bus: 60, risk: 0.5 },
};
/** Last bit of the trip, for the info line only (not in the cost): speed in km/h. */
export const CAR_KMH = 40; // picked up: car minutes only, no fixed waiting time
export const WALK_KMH: Record<TravelWith, number> = { nothing: 4.5, luggage: 3.5, bike: 15, reduced_mobility: 3 };
const REPLACEMENT_BUS_UNCERTAINTY_MIN = 10;

interface Weights {
  change: number; bus: number; risk: number;
  lastMileKmh: number; walkMaxKm: number;
}

function weights(a: PersonalAnswers): Weights {
  return {
    ...TRADE_OFF_WEIGHTS[a.tradeOff],
    lastMileKmh: WALK_KMH[a.travelWith],
    walkMaxKm: a.travelWith === "reduced_mobility" ? 1 : WALK_MAX_KM,
  };
}

export interface LastMile { mode: "walk" | "bike" | "pickup"; km: number; minutes: number }

export interface Scored {
  alt: Alternative;
  cost: number;
  /** expected arrival at the destination itself, ms */
  expectedArrival: number;
  lastMile: LastMile | null;
  isWait: boolean;
  feasible: boolean;
  conflict: string | null; // why it breaks one of the answers
}

export interface PersonalPick {
  alt: Alternative;
  reasons: string[];          // 1 to 3 short lines, shown under the card
  compromise: string | null;  // set when no option fits every answer
  arrivalAtDestination: string;
  lastMile: LastMile | null;
}

const BUS_MODES = new Set(["bus"]);
const isWaitOption = (a: Alternative) => a.category === "wait" || !!a.uses_blocked_line;
const rides = (a: Alternative) => a.legs.filter((l) => l.mode !== "walk" && l.mode !== "wait");
const signature = (a: Alternative) =>
  a.legs.map((l) => `${l.mode}|${l.line ?? ""}|${l.from_stop.id}|${l.to_stop.id}|${l.departure}`).join(">");

/** One entry per distinct trip (the categories overlap), usable ones first. */
export function uniqueOptions(res: AlternativesResponse): Alternative[] {
  const all = Object.values(res.by_category).flat();
  all.sort((x, y) => Number(!!x.disabled_reason) - Number(!!y.disabled_reason));
  const seen = new Set<string>();
  return all.filter((a) => {
    const k = signature(a);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function lastMileOf(
  a: Alternative, ans: PersonalAnswers, w: Weights, maxKm: number, destinationId: string | null,
): { lm: LastMile | null; conflict: string | null } {
  const km = a.distance_to_destination_km ?? 0;
  const tooFar = `Ends ${km.toFixed(1)} km from your destination`;
  // "Right at my destination": only trips ending at the destination station itself
  if (ans.stop === "exact") {
    const atDestination = destinationId ? a.final_stop.id === destinationId : km === 0;
    return { lm: null, conflict: atDestination ? null : tooFar };
  }
  if (km <= AT_DESTINATION_KM) return { lm: null, conflict: null };
  if (km > maxKm) return { lm: null, conflict: tooFar };
  const self: LastMile = {
    mode: ans.travelWith === "bike" ? "bike" : "walk", km,
    minutes: Math.round((km / w.lastMileKmh) * 60),
  };
  if (ans.stop === "walk") {
    return km <= w.walkMaxKm ? { lm: self, conflict: null } : { lm: null, conflict: tooFar };
  }
  // picked up: car minutes only
  return { lm: { mode: "pickup", km, minutes: Math.round((km / CAR_KMH) * 60) }, conflict: null };
}

/** Minutes of uncertainty on top of the timetable. */
function uncertaintyMinutes(a: Alternative, status: DisruptionStatus | null): number {
  if (isWaitOption(a)) {
    const e = status?.estimate;
    // the reopening is often later than announced: use our median estimate
    if (e?.official_end && e.median_end) return Math.max(0, minutesBetween(e.official_end, e.median_end));
    if (a.arrival_latest) return Math.max(0, minutesBetween(a.arrival, a.arrival_latest)) / 2;
    return 15;
  }
  // reliability gauge (Prevention): usual delay from road traffic at that hour
  const road = a.reliability ? a.reliability.expected_delay_minutes
    : Math.max(0, ...a.legs.map((l) => l.road_delay_minutes ?? 0));
  const replacement = a.legs.some((l) => l.mode === "replacement_bus") ? REPLACEMENT_BUS_UNCERTAINTY_MIN : 0;
  return replacement + road;
}

export function score(a: Alternative, ans: PersonalAnswers, p: Preferences, status: DisruptionStatus | null): Scored {
  const w = weights(ans);
  const maxKm = ans.stop === "exact" ? AT_DESTINATION_KM : Math.max(AT_DESTINATION_KM, p.destination_radius_km);
  const { lm, conflict: stopConflict } = lastMileOf(a, ans, w, maxKm, status?.journey?.destination.id ?? null);
  const legs = rides(a);
  const buses = legs.filter((l) => BUS_MODES.has(l.mode)).length;
  const replacement = legs.some((l) => l.mode === "replacement_bus");

  let conflict = stopConflict;
  if (!conflict && ans.travelWith === "bike" && (buses > 0 || replacement)) conflict = "Bikes are not taken on buses";
  if (!conflict && ans.travelWith === "reduced_mobility" && a.accessible === false) conflict = "Not step-free";
  if (!conflict && a.disabled_reason) conflict = a.disabled_reason;

  const wait = isWaitOption(a);
  const uncertainty = uncertaintyMinutes(a, status);
  const now = status?.estimate?.as_of ?? status?.last_update ?? a.departure ?? a.arrival;

  const cost = minutesBetween(now, a.arrival)
    + w.change * a.transfers
    + w.bus * (replacement ? 1 : 0)
    + w.risk * uncertainty;
  const expectedArrival = new Date(a.arrival).getTime() + uncertainty * 60_000;

  return { alt: a, cost, expectedArrival, lastMile: lm, isWait: wait, feasible: !conflict, conflict };
}

function best(list: Scored[]): Scored | null {
  return list.reduce<Scored | null>((b, s) => (!b || s.cost < b.cost ? s : b), null);
}

/** The single best itinerary for these answers, with the reasons in plain words. */
export function personalPick(
  res: AlternativesResponse, p: Preferences, status: DisruptionStatus | null, ans = answersOf(p),
): PersonalPick | null {
  if (!ans) return null;
  const options = uniqueOptions(res);
  if (!options.length) return null;
  const scored = options.map((a) => score(a, ans, p, status));
  const feasible = scored.filter((s) => s.feasible);
  const chosen = best(feasible) ?? best(scored)!;

  // The same traveller if they had answered "Nothing, keep it simple": used to
  // say what the extra effort buys.
  const simple = best(options.map((a) => score(a, { ...ans, tradeOff: "simplest" }, p, status)).filter((s) => s.feasible));
  const fastest = feasible.reduce<Scored | null>((b, s) => (!b || s.expectedArrival < b.expectedArrival ? s : b), null);
  const simpleSame = simple ? scored.find((s) => s.alt === simple.alt) ?? null : null;

  return {
    alt: chosen.alt,
    reasons: reasonsFor(chosen, ans, simpleSame, fastest, feasible),
    compromise: chosen.feasible ? null : `No option fits all your answers. Closest one: ${chosen.conflict?.toLowerCase()}.`,
    arrivalAtDestination: chosen.alt.arrival,
    lastMile: chosen.lastMile,
  };
}

function changesLabel(n: number): string {
  return n === 0 ? "direct" : `${n} change${n > 1 ? "s" : ""}`;
}

/** What the other option asks for that the chosen one does not. */
function effortOf(other: Scored, chosen: Scored): string {
  if (other.isWait && !chosen.isWait) return "waiting for the line to reopen";
  const extra = other.alt.transfers - chosen.alt.transfers;
  if (extra > 0) return `${extra} more change${extra > 1 ? "s" : ""}`;
  const legs = rides(other.alt);
  if (legs.some((l) => l.mode === "replacement_bus")) return "the replacement bus";
  if (legs.some((l) => l.mode === "bus")) return "a bus";
  if ((other.lastMile?.km ?? 0) > (chosen.lastMile?.km ?? 0)) return "getting off further away";
  return "a less comfortable route";
}

/** Minutes later of the best usable option with fewer changes, if any. */
function simplerButLater(c: Scored, feasible: Scored[]): number | null {
  const simpler = feasible.filter((s) => s.alt.transfers < c.alt.transfers);
  if (!simpler.length) return null;
  const m = Math.round((Math.min(...simpler.map((s) => s.expectedArrival)) - c.expectedArrival) / 60_000);
  return m >= 5 ? m : null;
}

function reasonsFor(c: Scored, ans: PersonalAnswers, simple: Scored | null, fastest: Scored | null, feasible: Scored[]): string[] {
  const out: string[] = [];
  const mins = (ms: number) => Math.round(ms / 60_000);
  const what = changesLabel(c.alt.transfers).replace(/^./, (x) => x.toUpperCase());

  // 1. the trade-off
  if (simple && simple.alt !== c.alt) {
    const saved = mins(simple.expectedArrival - c.expectedArrival);
    const fewer = simple.alt.transfers - c.alt.transfers;
    const head = c.isWait ? `Wait for the line to reopen, then ${changesLabel(c.alt.transfers)}` : what;
    if (saved >= 1) out.push(`Saves about ${durationLabel(saved)} with ${effortOf(c, simple)}: you said that's fine.`);
    else if (fewer > 0) {
      out.push(`${head}: ${fewer} fewer change${fewer > 1 ? "s" : ""} than the other way${-saved >= 1 ? `, for about ${durationLabel(-saved)} more` : ""}.`);
    } else out.push(`${head}: fits your answers better than the quicker options.`);
  } else {
    const head = c.isWait ? "Wait for the line to reopen" : what;
    const faster = fastest && fastest.alt !== c.alt ? mins(c.expectedArrival - fastest.expectedArrival) : 0;
    const later = simplerButLater(c, feasible);
    if (faster >= 5) out.push(`${head}${ans.tradeOff === "simplest" ? ": the simplest way" : ""}. Saving ${durationLabel(faster)} would need ${effortOf(fastest!, c)}.`);
    else if (later) out.push(`${head} and your quickest way. With fewer changes you would arrive ${durationLabel(later)} later.`);
    else out.push(c.isWait ? "Waiting for the line to reopen is also your quickest way." : `${what} and your quickest way.`);
  }

  // 2. where it ends
  const lm = c.lastMile;
  if (!lm) out.push("Takes you right to your destination.");
  else if (lm.mode === "pickup") out.push(`Ends at ${c.alt.final_stop.name}, ${lm.km.toFixed(1)} km away: about ${lm.minutes} min until you are picked up and there.`);
  else out.push(`Ends at ${c.alt.final_stop.name}, ${lm.km.toFixed(1)} km away: about ${lm.minutes} min ${lm.mode === "bike" ? "by bike" : "on foot"}.`);

  // 3. what you travel with
  const hasBus = rides(c.alt).some((l) => l.mode === "bus" || l.mode === "replacement_bus");
  const fewest = Math.min(...feasible.map((s) => s.alt.transfers), c.alt.transfers) === c.alt.transfers;
  if (ans.travelWith === "bike") {
    out.push(hasBus ? "Has a bus leg: bikes may not be taken on board." : "Trains only, so you can take your bike. Check if a bike reservation is needed.");
  } else if (ans.travelWith === "luggage") {
    out.push(hasBus ? "Includes a bus: little room for luggage or a stroller." : `No bus, ${changesLabel(c.alt.transfers)}: easier with luggage or a stroller.`);
  } else if (ans.travelWith === "reduced_mobility") {
    out.push(c.alt.accessible ? "Step-free connection."
      : `${fewest ? "Fewest changes possible. " : ""}Step-free access is not confirmed: ask SBB for boarding help if needed.`);
  }
  return out;
}
