// Small helpers for the prevention features (docs/prevention-frontend-handoff.md).
import type { Alternative, BusDelayForecast, PlannedTrip } from "../types";

/** Our bus forecast (idea 4) is worth showing only when it sees more than SBB does. */
export function usefulForecast(f: BusDelayForecast | undefined): f is BusDelayForecast {
  return !!f && (f.source === "tomtom_live" || f.source === "simulated") && f.extra_minutes >= 2;
}

/** Forecast explanation without the "[simulated ...]" suffix (nicer on stage). */
export function forecastText(f: BusDelayForecast): string {
  return f.explanation.replace(/\s*\[simulated[^\]]*\]\s*/gi, " ").trim();
}

/** A "Plan a trip" result (idea 3) shown with the same cards as the alternatives. */
export function plannedToAlternative(p: PlannedTrip, withDeadline: boolean): Alternative {
  const rides = p.legs.filter((l) => l.mode !== "walk" && l.mode !== "wait");
  const last = p.legs[p.legs.length - 1];
  return {
    id: p.id, category: "fastest", legs: p.legs, arrival: p.arrival, departure: p.departure,
    final_stop: last.to_stop, distance_to_destination_km: 0, transfers: p.transfers, score: 0,
    ticket_valid: null, ticket_hint: null,
    title: rides.length > 1 ? `Via ${rides[0].to_stop.name}` : `Direct ${rides[0]?.line ?? "connection"}`,
    reliability: p.reliability, recommended: p.recommended,
    on_time_probability: withDeadline ? p.reliability.on_time_probability : null,
  };
}
