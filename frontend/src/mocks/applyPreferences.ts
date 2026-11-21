// Mock-side version of what the backend ranking (workstream B) should do:
// - disable options that contradict the user's answers (with the reason),
// - compute the chance to arrive by the user's deadline,
// - re-sort each list and pick one recommended option.
import type { Alternative, AlternativeCategory, AlternativesResponse, Certainty, Preferences, ProbabilityPoint } from "../types";
import { onTimeChance } from "../lib/chance";

const BUS_MODES = new Set(["bus", "replacement_bus"]);
const CERTAINTY_RANK: Record<Certainty, number> = { safe: 0, likely: 1, uncertain: 2 };

function check(a: Alternative, p: Preferences, curve: ProbabilityPoint[], now: string): Alternative {
  const reasons: string[] = [];
  const warnings = [...(a.warnings ?? [])];

  if (p.avoid_replacement_bus && a.legs.some((l) => l.mode === "replacement_bus")) {
    reasons.push("You chose to avoid replacement buses");
  }
  if (a.category === "nearby" && a.distance_to_destination_km > p.destination_radius_km) {
    reasons.push(`More than ${p.destination_radius_km} km from your destination`);
  }
  if ((p.accessible_only || p.stroller_bike) && a.accessible === false) {
    reasons.push("Not step-free");
  }
  if (p.max_transfers != null && a.transfers > p.max_transfers) {
    reasons.push(`More than ${p.max_transfers} change(s)`);
  }
  if (p.luggage && a.legs.some((l) => BUS_MODES.has(l.mode))) {
    warnings.push("Little room for luggage on the bus");
  }

  return {
    ...a, warnings, disabled_reason: reasons[0] ?? null, recommended: false,
    on_time_probability: p.deadline ? onTimeChance(a, p.deadline, curve, now) : null,
  };
}

const arrivalOf = (a: Alternative) => new Date(a.arrival).getTime();

function compare(category: AlternativeCategory | "all", p: Preferences) {
  return (x: Alternative, y: Alternative) => {
    if (!!x.disabled_reason !== !!y.disabled_reason) return x.disabled_reason ? 1 : -1;
    if (p.deadline) {
      const d = (y.on_time_probability ?? 0) - (x.on_time_probability ?? 0);
      if (Math.abs(d) > 0.05) return d;
    }
    if (category === "comfort" || category === "all") {
      const d = CERTAINTY_RANK[x.certainty ?? "uncertain"] - CERTAINTY_RANK[y.certainty ?? "uncertain"];
      if (d) return d;
    }
    if (category === "comfort" || p.few_transfers) {
      const d = x.transfers - y.transfers;
      if (d) return d;
    }
    return arrivalOf(x) - arrivalOf(y);
  };
}

/** All usable options, one per route (categories overlap), best first. */
export function rankedOptions(res: AlternativesResponse, p: Preferences): Alternative[] {
  const seen = new Set<string>();
  const all = Object.values(res.by_category).flat().filter((a) => !a.disabled_reason);
  all.sort(compare("all", p));
  return all.filter((a) => {
    const key = a.title ?? a.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * The few options worth showing next to our advice: the best one of each kind
 * (another route, getting off nearby, waiting), so "wait" is always compared.
 */
export function otherOptions(res: AlternativesResponse, p: Preferences, advice: Alternative | null, max = 3): Alternative[] {
  const ranked = rankedOptions(res, p);
  const picked: Alternative[] = [];
  for (const list of Object.values(res.by_category)) {
    const best = list.find((a) => !a.disabled_reason && a.title !== advice?.title && !picked.some((x) => x.title === a.title));
    if (best) picked.push(best);
  }
  const order = (a: Alternative) => ranked.findIndex((r) => r.title === a.title);
  return picked.sort((a, b) => order(a) - order(b)).slice(0, max);
}

export function pickAdvice(res: AlternativesResponse, p: Preferences): Alternative | null {
  return rankedOptions(res, p)[0] ?? null;
}

export function applyPreferences(res: AlternativesResponse, p: Preferences, curve: ProbabilityPoint[], now: string): AlternativesResponse {
  const by = {} as AlternativesResponse["by_category"];
  for (const [cat, list] of Object.entries(res.by_category) as [AlternativeCategory, Alternative[]][]) {
    by[cat] = list.map((a) => check(a, p, curve, now)).sort(compare(cat, p));
  }
  const out = { ...res, by_category: by };
  const best = pickAdvice(out, p);
  if (best) {
    for (const list of Object.values(by)) for (const a of list) if (a.title === best.title) a.recommended = true;
  }
  return out;
}
