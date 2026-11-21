// Mirror of backend/app/models.py. Keep both in sync.

export interface Stop { id: string; name: string; lat?: number | null; lon?: number | null }

export interface Journey {
  id: string; origin: Stop; destination: Stop; departure: string; arrival: string; line: string;
}

export interface ReopeningEstimate {
  official_end: string | null;
  likely_end_earliest: string | null;
  likely_end_latest: string | null;
  confidence: number | null;
  similar_incidents_count: number;
  explanation: string;
}

export interface DisruptionStatus {
  incident_id: string; journey_id: string; title: string;
  reason: string | null; affected_section: string | null;
  estimate: ReopeningEstimate; last_update: string;
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
