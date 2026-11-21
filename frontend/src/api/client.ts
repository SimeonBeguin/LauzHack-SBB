// Thin wrapper around the backend. Everything the app shows comes from here:
// there is no mock data. VITE_JOURNEY_ID picks the demo journey: "demo-zh"
// (Zürich HB -> Hinwil, simulated incident, default) or "demo-1" (Lausanne ->
// Bern, real incident of 25.09.2026 replayed from the data).
import type {
  AlternativesResponse, BookedTrip, BookingAlert, BookingStatus, BusDelayResponse, CommuterAlert, CommuterTrip,
  DisruptionStatus, IncidentDetails, Preferences, ReliablePlanResponse, Situation, SituationAction, Stop,
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
// include_reliability: each option gets its reliability gauge (Prevention, idea 3)
export const getAlternatives = (preferences: Preferences, journeyId = JOURNEY_ID) =>
  post<AlternativesResponse>("/alternatives", { journey_id: journeyId, preferences, include_reliability: true });

// Commuter alerts
export const registerCommuterTrip = (trip: CommuterTrip) => post<CommuterTrip>("/commuters/trips", trip);
export const listCommuterTrips = (userId = USER_ID) =>
  request<CommuterTrip[]>(`/commuters/trips?user_id=${encodeURIComponent(userId)}`);
export const getAlerts = (userId = USER_ID) => request<CommuterAlert[]>(`/commuters/${userId}/alerts`);

export const searchStops = (q: string) => request<Stop[]>(`/stops?q=${encodeURIComponent(q)}`);

// --- Prevention (docs/prevention-frontend-handoff.md) ---
// simulate_jam_minutes: demo traffic jam on every bus leg (presenter control)
const jam = (m?: number | null) => (m ? `simulate_jam_minutes=${m}` : "");

// Idea 3: trips ranked by reliability
export const planReliable = (body: {
  origin_stop_id: string; destination_stop_id: string; departure: string;
  deadline?: string | null; num_results?: number;
}) => post<ReliablePlanResponse>("/prevention/plan", body);

// Idea 4: future delay of a bus from the traffic ahead
export const getBusDelay = (origin: string, destination: string, departure: string, simulateJam?: number | null) =>
  request<BusDelayResponse>(`/prevention/bus-delay?${new URLSearchParams({
    origin_stop_id: origin, destination_stop_id: destination, departure,
  })}&${jam(simulateJam)}`);

// Idea 2: booked trips
export const addBooking = (b: BookedTrip) => post<BookedTrip>("/prevention/bookings", b);
export const listBookings = (userId = USER_ID) =>
  request<BookedTrip[]>(`/prevention/bookings?user_id=${encodeURIComponent(userId)}`);
export const deleteBooking = (id: string) =>
  request<{ ok: boolean }>(`/prevention/bookings/${id}`, { method: "DELETE" });
export const getBookingStatus = (id: string, simulateJam?: number | null) =>
  request<BookingStatus>(`/prevention/bookings/${id}/status?${jam(simulateJam)}`);
export const getBookingAlerts = (userId = USER_ID, simulateJam?: number | null) =>
  request<BookingAlert[]>(`/prevention/${encodeURIComponent(userId)}/booking-alerts?${jam(simulateJam)}`);
