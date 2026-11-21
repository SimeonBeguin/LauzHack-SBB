// Thin wrapper around the backend.
// Mocks are ON by default (the replayed demo scenario). Set VITE_USE_MOCKS=false
// to call the backend. If a backend call fails, we fall back to the mock so the
// demo never breaks.
import type { AlternativesResponse, CommuterTrip, DisruptionStatus, Notification, Preferences } from "../types";
import { DELAY_STEPS } from "../mocks/scenario";
import { applyPreferences } from "../mocks/applyPreferences";

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

const stepOf = (step: number) => DELAY_STEPS[Math.min(step, DELAY_STEPS.length - 1)];

/** `step` = index of the replayed incident version (the backend may ignore it). */
export function getJourneyStatus(journeyId: string, step: number): Promise<DisruptionStatus> {
  return withFallback(
    () => request(`/journeys/${journeyId}/status?replay_step=${step}`),
    () => stepOf(step).status,
  );
}

export function getAlternatives(journeyId: string, preferences: Preferences, step: number): Promise<AlternativesResponse> {
  return withFallback(
    () => request("/alternatives", {
      method: "POST",
      body: JSON.stringify({ journey_id: journeyId, preferences, replay_step: step }),
    }),
    () => applyPreferences(stepOf(step).alternatives, preferences),
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
