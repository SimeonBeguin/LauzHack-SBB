// Mock-side version of what the backend ranking (workstream B) should do:
// disable options that contradict the user's answers (with the reason),
// re-sort each list, and pick one recommended option.
import type { Alternative, AlternativeCategory, AlternativesResponse, Certainty, Preferences } from "../types";
import { hhmm } from "../lib/format";

const BUS_MODES = new Set(["bus", "replacement_bus"]);
const CERTAINTY_RANK: Record<Certainty, number> = { safe: 0, likely: 1, uncertain: 2 };

function check(a: Alternative, p: Preferences): Alternative {
  const reasons: string[] = [];
  const warnings = [...(a.warnings ?? [])];

  if (p.avoid_replacement_bus && a.legs.some((l) => l.mode === "replacement_bus")) {
    reasons.push("You chose to avoid replacement buses");
  }
  if (a.category === "nearby" && a.distance_to_destination_km > p.destination_radius_km) {
    reasons.push(`Outside your ${p.destination_radius_km} km radius`);
  }
  if (p.deadline && new Date(a.arrival) > new Date(p.deadline)) {
    reasons.push(`Arrives after your ${hhmm(p.deadline)} deadline`);
  }
  if ((p.accessible_only || p.stroller_bike) && a.accessible === false) {
    reasons.push("Not step-free");
  }
  if (p.max_transfers != null && a.transfers > p.max_transfers) {
    reasons.push(`More than ${p.max_transfers} transfer(s)`);
  }
  if (p.luggage && a.legs.some((l) => BUS_MODES.has(l.mode))) {
    warnings.push("Luggage difficult on the bus");
  }

  return { ...a, warnings, disabled_reason: reasons[0] ?? null, recommended: false };
}

function sortFor(category: AlternativeCategory, p: Preferences) {
  return (x: Alternative, y: Alternative) => {
    if (!!x.disabled_reason !== !!y.disabled_reason) return x.disabled_reason ? 1 : -1;
    if (category === "comfort") {
      // Comfort = least stress: certain first, then fewest transfers.
      const d = CERTAINTY_RANK[x.certainty ?? "uncertain"] - CERTAINTY_RANK[y.certainty ?? "uncertain"] || x.transfers - y.transfers;
      if (d) return d;
    }
    if (p.few_transfers) {
      const d = x.transfers - y.transfers;
      if (d) return d;
    }
    return new Date(x.arrival).getTime() - new Date(y.arrival).getTime();
  };
}

/** Best option overall: enabled, most certain, then earliest arrival. */
export function pickAdvice(res: AlternativesResponse): Alternative | null {
  const all = Object.values(res.by_category).flat().filter((a) => !a.disabled_reason);
  all.sort((x, y) =>
    CERTAINTY_RANK[x.certainty ?? "uncertain"] - CERTAINTY_RANK[y.certainty ?? "uncertain"] ||
    new Date(x.arrival).getTime() - new Date(y.arrival).getTime());
  return all[0] ?? null;
}

export function applyPreferences(res: AlternativesResponse, p: Preferences): AlternativesResponse {
  const by = {} as AlternativesResponse["by_category"];
  for (const [cat, list] of Object.entries(res.by_category) as [AlternativeCategory, Alternative[]][]) {
    by[cat] = list.map((a) => check(a, p)).sort(sortFor(cat, p));
  }
  const out = { ...res, by_category: by };
  const best = pickAdvice(out);
  if (best) best.recommended = true;
  return out;
}
