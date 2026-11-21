// Thin wrapper around the backend. Set VITE_USE_MOCKS=true to work without the backend.
import type { AlternativesResponse, CommuterTrip, DisruptionStatus, Preferences } from "../types";
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

export function getJourneyStatus(journeyId: string): Promise<DisruptionStatus> {
  if (USE_MOCKS) return Promise.resolve(mockStatus);
  return request(`/journeys/${journeyId}/status`);
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
