// Mirror of backend/app/models.py. Keep both in sync.
// Fields marked "(UI)" were added for the frontend. They are optional, so the
// current backend stubs still validate.

export interface Stop { id: string; name: string; lat?: number | null; lon?: number | null }

export interface Journey {
  id: string; origin: Stop; destination: Stop; departure: string; arrival: string; line: string;
}

/** "There is a p chance the line has reopened before `before`." (UI) */
export interface ProbabilityPoint { before: string; p: number }

export type Reliability = "good" | "fair" | "low";

export interface ReopeningEstimate {
  official_end: string | null;
  /** How SBB phrases the end: "around", "at least until", "until" (UI) */
  official_label?: string | null;
  likely_end_earliest: string | null;
  likely_end_latest: string | null;
  confidence: number | null;
  similar_incidents_count: number;
  explanation: string;
  /** Cumulative probabilities, sorted by time (UI) */
  probabilities?: ProbabilityPoint[];
  /** Advice: "plan a margin until ..." (UI) */
  margin_until?: string | null;
  /** Calibration quality of the model for this kind of incident (UI) */
  reliability?: Reliability | null;
}

export type DisruptionKind = "interruption" | "restriction" | "resolved";

/** Internal SBB information (KULT ticker), shown on demand. (UI) */
export interface IncidentDetails {
  source: string;
  summary: string;
  cancelled_trains: string[];
  replacement_bus: string[];
  recommendation: string | null;
  ticket_rules: string | null;
}

export interface DisruptionStatus {
  incident_id: string; journey_id: string; title: string;
  reason: string | null; affected_section: string | null;
  estimate: ReopeningEstimate; last_update: string;
  kind?: DisruptionKind;                 // (UI)
  started_at?: string | null;            // (UI)
  journey?: Journey | null;              // (UI) planned journey, for the header
  changes?: string[];                    // (UI) what changed since the previous version
  details?: IncidentDetails | null;      // (UI)
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

export type LegMode = "train" | "bus" | "replacement_bus" | "walk" | "tram" | "wait";

export interface Leg {
  mode: LegMode | string; line: string | null; from_stop: Stop; to_stop: Stop;
  departure: string; arrival: string; road_delay_minutes: number | null;
}

export type Certainty = "safe" | "likely" | "uncertain";

export interface Alternative {
  id: string; category: AlternativeCategory; legs: Leg[]; arrival: string; final_stop: Stop;
  distance_to_destination_km: number; transfers: number; score: number;
  ticket_valid: boolean | null; ticket_hint: string | null;
  title?: string;                      // (UI) "Via Neuchâtel"
  subtitle?: string;                   // (UI) "IC 5 → RE · 1 transfer"
  departure?: string;                  // (UI)
  arrival_latest?: string | null;      // (UI) for ranges, e.g. the "wait" option
  certainty?: Certainty;               // (UI)
  certainty_reason?: string;           // (UI) one line of why
  recommended?: boolean;               // (UI)
  disabled_reason?: string | null;     // (UI) conflicts with the user's answers
  accessible?: boolean;                // (UI) step-free
  uses_blocked_line?: boolean;         // (UI)
  warnings?: string[];                 // (UI) e.g. "Bus: +5 to +15 min (traffic)"
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
