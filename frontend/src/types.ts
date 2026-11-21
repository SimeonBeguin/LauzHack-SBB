// Mirror of backend/app/models.py. Keep both in sync.

export interface Stop { id: string; name: string; lat?: number | null; lon?: number | null }

export interface Journey {
  id: string; origin: Stop; destination: Stop; departure: string; arrival: string; line: string;
}

export interface EndProbability {
  time: string;
  probability_ended: number; // 0.7 = "over by then in 70 % of similar cases"
}

export interface ReopeningEstimate {
  official_end: string | null;
  likely_end_earliest: string | null; // never after official_end
  likely_end_latest: string | null;   // never before official_end
  confidence: number | null;          // P(end inside the likely range)
  similar_incidents_count: number;
  explanation: string;
  // Added by Data & estimation (optional in the mocks)
  ended?: boolean;
  as_of?: string | null;
  elapsed_minutes?: number | null;
  median_end?: string | null;
  wide_end_earliest?: string | null; // 10th percentile
  wide_end_latest?: string | null;   // 90th percentile
  probabilities?: EndProbability[];
  method?: string; // "official_corrected" | "survival" | "ended" | "mock"
}

export interface DisruptionStatus {
  incident_id: string; journey_id: string; title: string;
  reason: string | null; affected_section: string | null;
  estimate: ReopeningEstimate; last_update: string;
}

export interface TimelinePoint {
  time: string; title: string; kind: string; duration_type: string | null;
  official_end: string | null; estimate: ReopeningEstimate; what_changed: string;
}

export interface IncidentTimeline {
  incident_id: string; title: string; reason: string | null; affected_section: string | null;
  start: string; real_end: string | null; points: TimelinePoint[];
}

export interface DepartureRisk {
  incident_id: string; departure: string; as_of: string;
  probability_still_disrupted: number; similar_incidents_count: number; explanation: string;
}

export interface InternalMessage { time: string; text: string }

export interface IncidentDetails {
  incident_id: string;
  found: boolean;
  kult_case_id: string | null;
  match_score: number | null;
  match_explanation: string;
  operating_concept: string | null;
  lines_affected: string[];
  replacement_buses: string[];
  cancelled_or_diverted_trains: string[];
  travel_recommendations: string[];
  ticket_goodwill: string[];
  internal_messages: InternalMessage[];
  internal_lead_minutes: number | null;
}

export interface Preferences {
  destination_radius_km: number;
  deadline: string | null;
  avoid_replacement_bus: boolean;
  max_transfers: number | null;
  accessible_only: boolean;
}

export const DEFAULT_PREFERENCES: Preferences = {
  destination_radius_km: 10,
  deadline: null,
  avoid_replacement_bus: true,
  max_transfers: null,
  accessible_only: false,
};

export type AlternativeCategory = "fastest" | "nearby" | "comfort" | "wait";

export interface Leg {
  mode: string; line: string | null; from_stop: Stop; to_stop: Stop;
  departure: string; arrival: string; road_delay_minutes: number | null;
}

export interface Alternative {
  id: string; category: AlternativeCategory; legs: Leg[]; arrival: string; final_stop: Stop;
  distance_to_destination_km: number; transfers: number; score: number;
  ticket_valid: boolean | null; ticket_hint: string | null;
}

export interface AlternativesResponse {
  journey_id: string;
  by_category: Record<AlternativeCategory, Alternative[]>;
}

export interface CommuterTrip {
  id?: string | null; user_id: string; origin_stop_id: string; destination_stop_id: string;
  departure_time: string; weekdays: number[]; push_token?: string | null;
}
