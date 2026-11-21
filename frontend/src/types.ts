// Mirror of backend/app/models.py. Keep both in sync.
// Fields marked "(UI)" were added by the frontend; they are optional.

export interface Stop { id: string; name: string; lat?: number | null; lon?: number | null }

export interface Journey {
  id: string; origin: Stop; destination: Stop; departure: string; arrival: string; line: string;
}

export interface EndProbability {
  time: string;
  probability_ended: number; // 0.7 = "over by then in 70 % of similar cases"
}

export type Reliability = "good" | "fair" | "low";

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
  // (UI)
  official_label?: string | null;    // "around", "at least until", "until"
  margin_until?: string | null;      // "to be safe, count on ..."
  reliability?: Reliability | null;
}

export type DisruptionKind = "interruption" | "restriction" | "resolved";

export interface DisruptionStatus {
  incident_id: string; journey_id: string; title: string;
  reason: string | null; affected_section: string | null;
  estimate: ReopeningEstimate; last_update: string;
  kind?: DisruptionKind;            // (UI)
  started_at?: string | null;       // (UI)
  journey?: Journey | null;         // (UI) planned journey, for the header
  changes?: string[];               // (UI) what changed since the previous version
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
  luggage?: boolean;        // (UI)
  stroller_bike?: boolean;  // (UI)
  few_transfers?: boolean;  // (UI)
  seat?: boolean;           // (UI)
}

export const DEFAULT_PREFERENCES: Preferences = {
  destination_radius_km: 10,
  deadline: null,
  avoid_replacement_bus: true,
  max_transfers: null,
  accessible_only: false,
  luggage: false,
  stroller_bike: false,
  few_transfers: false,
  seat: false,
};

export type AlternativeCategory = "fastest" | "nearby" | "comfort" | "wait";

export type LegMode = "train" | "bus" | "replacement_bus" | "walk" | "tram" | "metro" | "wait";

export interface Leg {
  mode: LegMode | string; line: string | null; from_stop: Stop; to_stop: Stop;
  departure: string; arrival: string; road_delay_minutes: number | null;
}

export type Certainty = "safe" | "likely" | "uncertain";

export interface Alternative {
  id: string; category: AlternativeCategory; legs: Leg[]; arrival: string; final_stop: Stop;
  distance_to_destination_km: number; transfers: number; score: number;
  ticket_valid: boolean | null; ticket_hint: string | null;
  title?: string | null;               // (UI) "Go via Neuchâtel"
  subtitle?: string | null;            // (UI)
  departure?: string | null;           // (UI)
  arrival_latest?: string | null;      // (UI) for ranges, e.g. the "wait" option
  certainty?: Certainty | null;        // (UI)
  certainty_reason?: string | null;    // (UI) one line of why
  recommended?: boolean;               // (UI)
  disabled_reason?: string | null;     // (UI) conflicts with the user's answers
  accessible?: boolean | null;         // (UI) step-free
  uses_blocked_line?: boolean;         // (UI)
  warnings?: string[];                 // (UI)
  on_time_probability?: number | null; // (UI) chance to arrive by preferences.deadline
}

export interface AlternativesResponse {
  journey_id: string;
  by_category: Record<AlternativeCategory, Alternative[]>;
}

export interface CommuterTrip {
  id?: string | null; user_id: string; origin_stop_id: string; destination_stop_id: string;
  departure_time: string; weekdays: number[]; push_token?: string | null;
  origin_name?: string | null;       // (UI)
  destination_name?: string | null;  // (UI)
  line?: string | null;              // (UI)
  arrival_time?: string | null;      // (UI)
}

export type NotificationKind = "earlier_train" | "own_train" | "resolved";

export interface Notification {
  trip_id: string;
  title: string;
  body: string;
  incident_id: string | null;
  created_at: string;
  id?: string;                    // (UI)
  kind?: NotificationKind;        // (UI)
  probability?: number | null;    // (UI) chance the commuter's own train is still hit
}

// --- Live situation of the demo incident (presenter controls) ---

export interface SituationUpdate { time: string; text: string }

export interface Situation {
  journey_id: string;
  incident_id: string;
  mode: "simulated" | "replay";
  section: string;
  start: string;
  clock: string;                 // "now" of the demo
  official_end: string | null;
  replacement_bus: boolean;
  resumed_at: string | null;
  updates: SituationUpdate[];
  next_update: string | null;    // replay: next real update
}

export type SituationAction =
  | { action: "advance"; minutes: number }
  | { action: "set_official_end"; time: string }
  | { action: "replacement_bus"; value: boolean }
  | { action: "resume" }
  | { action: "next_update" }
  | { action: "reset" };

// --- Commuter alerts, computed by the backend watcher ---

export type LineTrainState = "stuck" | "cancelled" | "at_risk" | "ok";

export interface LineTrain {
  departure: string; line: string | null; state: LineTrainState; note: string; yours: boolean;
}

export interface CommuterAlert {
  notification: Notification;
  trip: CommuterTrip;
  planned_departure: string;
  planned_arrival: string | null;
  headline: string;
  reasons: string[];
  line: LineTrain[];
  options: Alternative[];
}
