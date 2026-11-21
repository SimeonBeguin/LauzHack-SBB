// Thin wrapper around the backend. Everything the app shows comes from here:
// there is no mock data. VITE_JOURNEY_ID picks the demo journey: "demo-zh"
// (Zürich HB -> Hinwil, simulated incident, default) or "demo-1" (Lausanne ->
// Bern, real incident of 25.09.2026 replayed from the data).
import type {
  AlternativesResponse, CommuterAlert, CommuterTrip, DisruptionStatus, IncidentDetails, Preferences,
  Situation, SituationAction, Stop,
} from "../types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";
export const JOURNEY_ID: string = import.meta.env.VITE_JOURNEY_ID ?? "demo-zh";
export const USER_ID = "demo-user";

export class ApiError extends Error {}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, { headers: { "Content-Type": "application/json" }, ...init });
  } catch {
    throw new ApiError(`The server is not reachable (${API_URL}). Is the backend running?`);
  }
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new ApiError(body?.detail ?? `${res.status} ${path}`);
  }
  return res.json() as Promise<T>;
}

const post = <T>(path: string, body: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body) });

// Live situation (presenter controls). Every other call reflects it.
export const getSituation = (journeyId = JOURNEY_ID) => request<Situation>(`/situation/${journeyId}`);
export const changeSituation = (action: SituationAction, journeyId = JOURNEY_ID) =>
  post<Situation>(`/situation/${journeyId}`, action);

export const getJourneyStatus = (journeyId = JOURNEY_ID) => request<DisruptionStatus>(`/journeys/${journeyId}/status`);
export const getJourneyDetails = (journeyId = JOURNEY_ID) => request<IncidentDetails>(`/journeys/${journeyId}/details`);
export const getAlternatives = (preferences: Preferences, journeyId = JOURNEY_ID) =>
  post<AlternativesResponse>("/alternatives", { journey_id: journeyId, preferences });

// Commuter alerts
export const registerCommuterTrip = (trip: CommuterTrip) => post<CommuterTrip>("/commuters/trips", trip);
export const listCommuterTrips = (userId = USER_ID) =>
  request<CommuterTrip[]>(`/commuters/trips?user_id=${encodeURIComponent(userId)}`);
export const getAlerts = (userId = USER_ID) => request<CommuterAlert[]>(`/commuters/${userId}/alerts`);

export const searchStops = (q: string) => request<Stop[]>(`/stops?q=${encodeURIComponent(q)}`);
