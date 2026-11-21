// Thin wrapper around the backend. Set VITE_USE_MOCKS=true to work without the backend.
import type {
  AlternativesResponse, CommuterTrip, DepartureRisk, DisruptionStatus, IncidentDetails, IncidentTimeline, Preferences,
} from "../types";
import { mockAlternatives, mockStatus } from "../mocks/mockData";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
const USE_MOCKS = import.meta.env.VITE_USE_MOCKS === "true";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) throw new Error(`${res.status} ${path}`);
  return res.json() as Promise<T>;
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

export function getJourneyStatus(journeyId: string, opts?: ReplayOptions): Promise<DisruptionStatus> {
  if (USE_MOCKS) return Promise.resolve(mockStatus);
  return request(`/journeys/${journeyId}/status${replayQuery(opts)}`);
}

// "More details" screen: internal SBB info (KULT) known at the replay moment.
export function getJourneyDetails(journeyId: string, opts?: ReplayOptions): Promise<IncidentDetails> {
  return request(`/journeys/${journeyId}/details${replayQuery(opts)}`);
}

// Every published version of an incident + the estimate shown at that time (demo replay).
export function getIncidentTimeline(incidentId: string): Promise<IncidentTimeline> {
  return request(`/incidents/${incidentId}/timeline`);
}

// Commuter alert: P(line still disrupted when the train leaves). departure = "HH:MM" or ISO.
export function getDepartureRisk(incidentId: string, departure: string, opts?: ReplayOptions): Promise<DepartureRisk> {
  return request(`/incidents/${incidentId}/risk${replayQuery(opts, { departure })}`);
}

export function getAlternatives(journeyId: string, preferences: Preferences): Promise<AlternativesResponse> {
  if (USE_MOCKS) return Promise.resolve(mockAlternatives);
  return request("/alternatives", {
    method: "POST",
    body: JSON.stringify({ journey_id: journeyId, preferences }),
  });
}

export function registerCommuterTrip(trip: CommuterTrip): Promise<CommuterTrip> {
  return request("/commuters/trips", { method: "POST", body: JSON.stringify(trip) });
}
