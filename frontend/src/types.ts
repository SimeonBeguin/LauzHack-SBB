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
  // (UI) answers of the "Personalize" questions (see lib/personalize.ts)
  stop_choice?: StopChoice | null;
  trade_off?: TradeOff | null;
  travel_with?: TravelWith | null;
}

/** "Where can you get off?" */
export type StopChoice = "exact" | "walk" | "pickup";
/** "To save 20 min, you'd accept…" */
export type TradeOff = "anything" | "changes" | "wait" | "simplest";
/** "You're travelling with…" */
export type TravelWith = "nothing" | "luggage" | "bike" | "reduced_mobility";

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
  reliability?: TripReliability | null; // Prevention: only with include_reliability
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

export type NotificationKind =
  | "earlier_train" | "own_train" | "resolved"  // commuter alerts
  | "booked_train_disrupted" | "connection_broken" | "connection_at_risk" | "booking_back_to_normal"; // booked trips

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

// --- Prevention (mirror of the "Prevention" models in backend/app/models.py) ---
// Show words, not numbers: `label` + `reason`; if a number is needed, "x in 10".

export type ReliabilityLevel = "good" | "fair" | "low";

export interface LegReliability {
  mode: string; line: string | null; from_stop: Stop; to_stop: Stop; departure: string;
  road_exposure: number;              // 1 = bus in traffic, 0 = own track
  typical_congestion_minutes: number;
  expected_delay_minutes: number;
  level: ReliabilityLevel; reason: string;
}

export interface TransferRisk {
  at_stop: Stop; arrival: string; departure: string; walk_minutes: number;
  margin_minutes: number; expected_incoming_delay_minutes: number;
  probability_missed: number; level: ReliabilityLevel;
}

export interface TripReliability {
  level: ReliabilityLevel;
  label: string;                      // show this
  reason: string;                     // and this
  expected_delay_minutes: number;
  probability_late_5min: number;
  on_time_probability: number | null; // only when a deadline was given
  effective_arrival: string | null;
  road_share: number;
  legs: LegReliability[];
  transfers: TransferRisk[];
  source: "tomtom_historic" | "rush_hour_profile";
}

export interface PlannedTrip {
  id: string; legs: Leg[]; departure: string; arrival: string; transfers: number;
  reliability: TripReliability; recommended: boolean;
  note: string | null;                // "6 min later than the fastest, but more reliable: ..."
}
export interface ReliablePlanResponse { trips: PlannedTrip[]; ranking: string }

export interface StopForecast {
  stop: Stop; planned_arrival: string;
  official_delay_minutes: number; predicted_delay_minutes: number;
}
export interface SegmentForecast {
  from_stop: Stop; to_stop: Stop; reached_at: string;
  live_minutes: number | null; typical_minutes: number | null; free_flow_minutes: number | null;
  added_delay_minutes: number; jam: boolean;
}
export interface BusDelayForecast {
  line: string | null; from_stop: Stop; to_stop: Stop;
  planned_departure: string; planned_arrival: string; as_of: string;
  current_delay_minutes: number;
  official_delay_minutes: number;     // what SBB shows now
  predicted_delay_minutes: number;    // what we expect
  extra_minutes: number;              // predicted - official: > 0 = we see it before SBB
  stops: StopForecast[]; segments: SegmentForecast[];
  confidence: "high" | "medium" | "low";
  source: "tomtom_live" | "simulated" | "too_early" | "unavailable";
  explanation: string;
}
export interface BusDelayResponse {
  trip_departure: string | null; trip_arrival: string | null; forecasts: BusDelayForecast[];
}

export type TicketKind = "supersaver" | "point_to_point" | "travelcard";

export interface BookedTrip {
  id?: string | null; user_id: string;
  origin_stop_id: string; destination_stop_id: string;
  departure: string;                  // ISO, the backend snaps it to the real connection
  origin_name?: string | null; destination_name?: string | null;
  ticket_kind?: TicketKind;
  legs?: Leg[]; arrival?: string | null;  // filled by the backend
  push_token?: string | null;
}
export interface ConnectionCheck {
  at_stop: Stop; arrival: string; departure: string; margin_minutes: number;
  probability_missed: number; status: "ok" | "at_risk" | "broken"; cause: string;
}
export interface BookingAlert {
  notification: Notification; booking: BookedTrip; headline: string; reasons: string[];
  connections: ConnectionCheck[]; bus_forecasts: BusDelayForecast[];
  options: Alternative[]; ticket_note: string | null;
}
export type BookingState = "ok" | "at_risk" | "broken" | "disrupted" | "not_watched";
export interface BookingStatus {
  booking: BookedTrip; as_of: string;
  state: BookingState;
  summary: string; connections: ConnectionCheck[]; bus_forecasts: BusDelayForecast[];
  reliability: TripReliability | null;
}
