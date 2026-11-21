// Thin wrapper around the backend.
// Mocks are ON by default (the replayed demo scenario). Set VITE_USE_MOCKS=false
// to call the backend. If a backend call fails, we fall back to the mock so the
// demo never breaks.
import type {
  AlternativesResponse, CommuterTrip, DepartureRisk, DisruptionStatus, IncidentDetails, IncidentTimeline,
  Notification, Preferences,
} from "../types";
import { DELAY_DETAILS, DELAY_STEPS, INCIDENT_START } from "../mocks/scenario";
import { applyPreferences } from "../mocks/applyPreferences";
import { minutesBetween } from "../lib/format";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
export const USE_MOCKS = import.meta.env.VITE_USE_MOCKS !== "false";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
}

async function withFallback<T>(live: () => Promise<T>, mock: () => T): Promise<T> {
  if (USE_MOCKS) return mock();
  try {
    return await live();
  } catch (e) {
    console.warn("Backend call failed, using mock data:", e);
    return mock();
  }
}

// Replay moment of the demo incident: minutes after its start (default 45 on the backend).
export interface ReplayOptions { minutesSinceStart?: number; at?: string; live?: boolean }

function replayQuery(opts?: ReplayOptions, extra: Record<string, string> = {}): string {
  const p = new URLSearchParams(extra);
  if (opts?.minutesSinceStart !== undefined) p.set("minutes_since_start", String(opts.minutesSinceStart));
  if (opts?.at) p.set("at", opts.at);
  if (opts?.live !== undefined) p.set("live", String(opts.live));
  const q = p.toString();
  return q ? `?${q}` : "";
}

const stepOf = (step: number) => DELAY_STEPS[Math.min(step, DELAY_STEPS.length - 1)];

/** Replay options matching a step of the presenter panel. */
export function replayFor(step: number): ReplayOptions {
  return { minutesSinceStart: minutesBetween(INCIDENT_START, stepOf(step).clock), live: false };
}

/** `step` = index of the replayed incident version (presenter panel). */
export function getJourneyStatus(journeyId: string, step: number): Promise<DisruptionStatus> {
  return withFallback(
    () => request(`/journeys/${journeyId}/status${replayQuery(replayFor(step))}`),
    () => stepOf(step).status,
  );
}

// "Why and how long?" screen: internal SBB info (KULT) known at the replay moment.
export function getJourneyDetails(journeyId: string, step: number): Promise<IncidentDetails> {
  return withFallback(
    () => request(`/journeys/${journeyId}/details${replayQuery(replayFor(step))}`),
    () => DELAY_DETAILS[Math.min(step, DELAY_DETAILS.length - 1)],
  );
}

// Every published version of an incident + the estimate shown at that time (demo replay).
export function getIncidentTimeline(incidentId: string): Promise<IncidentTimeline> {
  return request(`/incidents/${incidentId}/timeline`);
}

// Commuter alert: P(line still disrupted when the train leaves). departure = "HH:MM" or ISO.
export function getDepartureRisk(incidentId: string, departure: string, opts?: ReplayOptions): Promise<DepartureRisk> {
  return request(`/incidents/${incidentId}/risk${replayQuery(opts, { departure })}`);
}

export function getAlternatives(journeyId: string, preferences: Preferences, step: number): Promise<AlternativesResponse> {
  return withFallback(
    () => request("/alternatives", {
      method: "POST",
      body: JSON.stringify({ journey_id: journeyId, preferences }),
    }),
    () => {
      const st = stepOf(step);
      return applyPreferences(st.alternatives, preferences, st.status.estimate.probabilities ?? [], st.clock);
    },
  );
}

export function registerCommuterTrip(trip: CommuterTrip): Promise<CommuterTrip> {
  return withFallback(
    () => request("/commuters/trips", { method: "POST", body: JSON.stringify(trip) }),
    () => ({ ...trip, id: trip.id ?? "trip-1" }),
  );
}

export function getNotifications(userId: string): Promise<Notification[]> {
  return withFallback(() => request(`/commuters/${userId}/notifications`), () => []);
}
