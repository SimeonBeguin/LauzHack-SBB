# Prevention: frontend handoff

The backend for the three prevention ideas is done (`backend/app/prevention/`,
routes in `backend/app/api/prevention.py`, tests in `backend/tests/test_prevention.py`).
Nothing in `frontend/` was changed. This page says what to add to the app and how.

| Idea | When the traveller sees it | Backend |
|---|---|---|
| **3. Reliability gauge** | While choosing a trip (hours or days before) | `POST /prevention/plan`, or `include_reliability` on `POST /alternatives` |
| **2. Booked-trip alerts** | Up to 24 h before departure, until arrival | `/prevention/bookings`, `GET /prevention/{user}/booking-alerts` |
| **4. Predicted bus delay** | 5 to 60 min before, and on the way | `GET /prevention/bus-delay` (also used inside idea 2) |

Story for the pitch: **before choosing** (3) → **hours before** (commuter and booked-trip
alerts, 1 and 2) → **minutes before** (4) → **during the disruption** (delay mode, already done).

## Rules from the delay mode (keep them)

- Show words, not numbers: `reliability.label` (`Reliable` / `Probably fine` / `Uncertain`)
  plus `reliability.reason` (one short sentence). `lib/chance.ts` already has the matching
  `RELIABILITY` words, and `ChanceTab` (corner tab on `ConnectionCard`) is the right place.
- If a number is needed, use "x in 10" (`inTen()` in `lib/chance.ts`), never percentages.
- One clear advice first, the rest one tap away.

## 1. Types to add to `frontend/src/types.ts`

Mirror of the new pydantic models at the end of `backend/app/models.py` ("Prevention").

```ts
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

export interface BookedTrip {
  id?: string | null; user_id: string;
  origin_stop_id: string; destination_stop_id: string;
  departure: string;                  // ISO, the backend snaps it to the real connection
  origin_name?: string | null; destination_name?: string | null;
  ticket_kind?: "supersaver" | "point_to_point" | "travelcard";
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
export interface BookingStatus {
  booking: BookedTrip; as_of: string;
  state: "ok" | "at_risk" | "broken" | "disrupted" | "not_watched";
  summary: string; connections: ConnectionCheck[]; bus_forecasts: BusDelayForecast[];
  reliability: TripReliability | null;
}
```

Also extend the existing types:

```ts
// Alternative
reliability?: TripReliability | null;     // only with include_reliability
// AlternativesRequest body
include_reliability?: boolean;
// Notification.kind: new values for booked trips
| "booked_train_disrupted" | "connection_broken" | "connection_at_risk" | "booking_back_to_normal"
```

## 2. Client calls to add to `frontend/src/api/client.ts`

Uses the existing `request`, `post` and `USER_ID` helpers of that file.

```ts
const jam = (m?: number) => (m != null ? `simulate_jam_minutes=${m}` : "");

// Idea 3
export const planReliable = (body: {
  origin_stop_id: string; destination_stop_id: string; departure: string;
  deadline?: string | null; num_results?: number;
}) => post<ReliablePlanResponse>("/prevention/plan", body);
// in getAlternatives: send { journey_id, preferences, include_reliability: true }

// Idea 4
export const getBusDelay = (origin: string, destination: string, departure: string, simulateJam?: number) =>
  request<BusDelayResponse>(`/prevention/bus-delay?${new URLSearchParams({
    origin_stop_id: origin, destination_stop_id: destination, departure,
  })}&${jam(simulateJam)}`);

// Idea 2
export const addBooking = (b: BookedTrip) => post<BookedTrip>("/prevention/bookings", b);
export const listBookings = (userId = USER_ID) =>
  request<BookedTrip[]>(`/prevention/bookings?user_id=${encodeURIComponent(userId)}`);
export const deleteBooking = (id: string) =>
  request<{ ok: boolean }>(`/prevention/bookings/${id}`, { method: "DELETE" });
export const getBookingStatus = (id: string, simulateJam?: number) =>
  request<BookingStatus>(`/prevention/bookings/${id}/status?${jam(simulateJam)}`);
export const getBookingAlerts = (userId = USER_ID, simulateJam?: number) =>
  request<BookingAlert[]>(`/prevention/${encodeURIComponent(userId)}/booking-alerts?${jam(simulateJam)}`);
```

## 3. Screens and where to plug them

### Idea 3: reliability gauge

- **Connections list (`screens/CategoryList.tsx`) and delay mode (`DisruptionMode.tsx`):**
  send `include_reliability: true` in `getAlternatives`, then show
  `alt.reliability.label` in the `ChanceTab` corner tab and `alt.reliability.reason` as the
  grey line under the timeline. When there is no deadline, `ChanceBadge` can use
  `reliability.level` instead of `certainty`.
- **Normal search (new, optional):** a "Plan a trip" screen calling `planReliable`. The list
  is already sorted (`ranking` = subtitle). Show `note` on the first card ("6 min later
  than the fastest, but more reliable") and on the fastest one if it is not first. This
  shows the "longer but safer" idea.
- **Connection detail (`ConnectionDetail.tsx`):** one line per risky leg from
  `reliability.legs[].reason` (bus legs only), and a warning on the "Change" pill row when
  `reliability.transfers[i].level !== "good"` ("Tight change").

### Idea 2: booked-trip alerts

- **Home (`screens/Home.tsx`):** a "Booked trips" section like "Regular trips", plus
  "Add a booked trip" (origin, destination, date and time, ticket kind) → `addBooking`.
- **Polling:** same loop as the commuter alerts in `store.tsx` (`getBookingAlerts(userId)`
  every few seconds, new ones → banner, lock screen and OS notification, as today).
- **Alert screen (new, copy `CommuterAlert.tsx`):** `headline`, then `connections` as change
  rows (`status` → green / orange / red, `cause` as the text), the first `options[0]` as
  "Our advice" (`ConnectionCard`), `ticket_note` in the ticket line, and `reasons` under
  "Why are we telling you this?".
- **Trip card status:** `getBookingStatus(id).state` → `ok` (nothing), `at_risk`
  ("Your change may be tight"), `broken` / `disrupted` (red, "What should I do?").

### Idea 4: predicted bus delay

- **Booked-trip alert:** `bus_forecasts[]` are already inside each `BookingAlert`; show
  `predicted_delay_minutes` next to the official one: "SBB shows: on time · We expect: +7 min".
- **Connection detail:** for each bus leg, `getBusDelay(...)`; if `extra_minutes >= 2`,
  show a small orange line on the leg card: `explanation`.
- `source === "too_early"` or `"unavailable"`: show nothing. `"simulated"`: fine for the demo,
  but don't show the "[simulated ...]" suffix on stage if you prefer (strip it).

## 4. Demo without waiting for real traffic

`simulate_jam_minutes` (0 to 60) on the bus-delay, booking-status and booking-alerts
routes adds a jam of that many minutes in the middle of each bus leg. It works without a
TomTom key. A presenter button "Traffic jam on the bus route" in `demo/DemoPanel.tsx`
can switch it on (keep the value in the store and pass it to the polling calls).

Suggested scene: book a trip **bus → train** with a 5 to 6 min change → everything is
"ok" → press "Traffic jam" → alert "Your change at X: you will probably miss it, the
bus will arrive 8 min late (traffic ahead)" with the next connection, before the bus
shows any delay in SBB's real-time data.

## 5. Keys, data and limits

- `TOMTOM_API_KEY` in `.env`: live traffic (idea 4) and historic traffic (idea 3).
  Without it, idea 3 falls back to a built-in rush-hour profile (`rush_hour_ratio`), and
  idea 4 answers `"unavailable"` unless `simulate_jam_minutes` is used.
- `OJP_API_KEY`: new searches (plan, bookings) need it once; `OJP_MODE=auto` then records
  the answers in `backend/data/ojp_recordings/`, so the demo replays them offline.
- Bookings and alerts are in memory (like the commuter trips). The presenter's reset
  (`POST /situation/{id}` `reset`) also clears the booking alerts.
- Constants to calibrate later with the real-time archive ("Ist-Daten",
  opentransportdata.swiss): `BASE_DELAY`, `CONGESTION_TO_DELAY`, the rush-hour profile
  (`reliability.py`), `HORIZON_FULL_MIN` / `HORIZON_ZERO_MIN`, `JAM_RATIO` (`bus_delay.py`).
- Idea 4 uses car times from TomTom (bus lanes and stops ignored) and only the part of
  the bus line the traveller rides (OJP gives calls from the boarding stop).
