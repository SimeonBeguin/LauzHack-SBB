"""Shared data contract between backend and frontend.

This file is the meeting point of the three workstreams. Change it together,
and mirror every change in frontend/src/types.ts.
"""

from datetime import datetime
from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Journey and disruption status (owner: Data & estimation)
# ---------------------------------------------------------------------------

class Stop(BaseModel):
    id: str  # SBB service point id (DiDok / sloid)
    name: str
    lat: float | None = None
    lon: float | None = None


class Journey(BaseModel):
    id: str
    origin: Stop
    destination: Stop
    departure: datetime
    arrival: datetime
    line: str  # e.g. "IC 5"


class EndProbability(BaseModel):
    """P(the line has reopened by `time`), e.g. 0.7 = "over by then in 70 % of similar cases"."""

    time: datetime
    probability_ended: float = Field(ge=0, le=1)


class ReopeningEstimate(BaseModel):
    """Official SBB time is the headline. Our statistics only add a margin
    around it and must never contradict it: the likely range always contains
    the official time (when it is still in the future)."""

    official_end: datetime | None = Field(None, description="End time published by SBB, if any")
    likely_end_earliest: datetime | None = None  # ~25th percentile, never after official_end
    likely_end_latest: datetime | None = None    # ~75th percentile, never before official_end
    confidence: float | None = Field(None, ge=0, le=1)  # P(end inside the likely range)
    similar_incidents_count: int = 0
    explanation: str = ""  # short human text, e.g. "Based on 34 similar incidents"
    # --- added by Data & estimation (all optional, safe to ignore) ---
    ended: bool = False                        # True once SBB reports service resumed
    as_of: datetime | None = None              # moment the estimate refers to
    elapsed_minutes: int | None = None         # how long the disruption has lasted at as_of
    median_end: datetime | None = None         # 50th percentile
    wide_end_earliest: datetime | None = None  # 10th percentile (80 % range)
    wide_end_latest: datetime | None = None    # 90th percentile (80 % range)
    probabilities: list[EndProbability] = []   # a few checkpoints for the UI text
    method: str = ""                           # "official_corrected", "survival", "ended", "mock"
    # --- added by Frontend (optional) ---
    official_label: str | None = None          # how SBB phrases it: "around", "at least until", "until"
    margin_until: datetime | None = None       # "to be safe, count on ..."
    reliability: Literal["good", "fair", "low"] | None = None


class DisruptionStatus(BaseModel):
    incident_id: str
    journey_id: str
    title: str
    reason: str | None = None
    affected_section: str | None = None
    estimate: ReopeningEstimate
    last_update: datetime
    # --- added by Frontend (optional) ---
    kind: Literal["interruption", "restriction", "resolved"] = "interruption"
    started_at: datetime | None = None
    journey: Journey | None = None
    changes: list[str] = []  # what changed since the previous version


class TimelinePoint(BaseModel):
    """One published version of an incident, with the estimate we would have shown then."""

    time: datetime
    title: str
    kind: str  # "interruption", "restriction", "resumed"
    duration_type: str | None = None
    official_end: datetime | None = None
    estimate: ReopeningEstimate
    what_changed: str = ""  # e.g. "SBB moved the end from 18:00 to 18:45"


class IncidentTimeline(BaseModel):
    """Full replay of a past incident, for the live demo."""

    incident_id: str
    title: str
    reason: str | None = None
    affected_section: str | None = None
    start: datetime
    real_end: datetime | None = None
    points: list[TimelinePoint]


class DepartureRisk(BaseModel):
    """For commuter alerts: will the line still be disrupted when my train leaves?"""

    incident_id: str
    departure: datetime
    as_of: datetime
    probability_still_disrupted: float = Field(ge=0, le=1)
    similar_incidents_count: int = 0
    explanation: str = ""


class InternalMessage(BaseModel):
    time: datetime
    text: str


class IncidentDetails(BaseModel):
    """'More details' screen: internal SBB info (KULT ticker) matched to a public incident.

    KULT has no common id with VIA: the match uses time, place and cause, and
    `match_score` / `match_explanation` say how sure we are.
    """

    incident_id: str
    found: bool = False
    kult_case_id: str | None = None
    match_score: float | None = None
    match_explanation: str = ""
    operating_concept: str | None = None          # e.g. "AESP - WANZ - RTR Total"
    lines_affected: list[str] = []                # from VIA, e.g. ["IR15", "RE33"]
    replacement_buses: list[str] = []             # ERSATZVERKEHR modules
    cancelled_or_diverted_trains: list[str] = []  # BETRIEBSKONZEPT_* and MASSNAHMEN modules
    travel_recommendations: list[str] = []        # REISEEMPFEHLUNG modules
    ticket_goodwill: list[str] = []               # KULANZMASNAHMEN modules
    internal_messages: list[InternalMessage] = []
    internal_lead_minutes: int | None = None      # how much earlier staff were informed than the public


# ---------------------------------------------------------------------------
# Personalisation and alternatives (owner: Routing & OJP)
# ---------------------------------------------------------------------------

class Preferences(BaseModel):
    """Answers from the Personalise flow. Defaults match the agreed plan."""

    destination_radius_km: float = 10.0
    deadline: datetime | None = None  # None = no deadline
    avoid_replacement_bus: bool = True
    max_transfers: int | None = None
    accessible_only: bool = False
    luggage: bool = False
    stroller_bike: bool = False
    few_transfers: bool = False
    seat: bool = False


class AlternativeCategory(str, Enum):
    FASTEST = "fastest"        # earliest arrival at the destination
    NEARBY = "nearby"          # arrive within radius of the destination
    COMFORT = "comfort"        # fewer transfers, no bus, seats
    WAIT = "wait"              # stay on the planned route and wait for reopening


class Leg(BaseModel):
    mode: str  # "train", "bus", "replacement_bus", "walk", ...
    line: str | None = None
    from_stop: Stop
    to_stop: Stop
    departure: datetime
    arrival: datetime
    road_delay_minutes: int | None = None  # optional, from TomTom/HERE for buses


class Alternative(BaseModel):
    id: str
    category: AlternativeCategory
    legs: list[Leg] = []
    arrival: datetime
    final_stop: Stop
    distance_to_destination_km: float = 0.0
    transfers: int = 0
    score: float = 0.0
    ticket_valid: bool | None = None
    ticket_hint: str | None = None
    # --- added by Frontend (optional) ---
    title: str | None = None  # "Go via Neuchâtel"
    subtitle: str | None = None
    departure: datetime | None = None
    arrival_latest: datetime | None = None  # for ranges, e.g. the "wait" option
    certainty: Literal["safe", "likely", "uncertain"] | None = None
    certainty_reason: str | None = None
    recommended: bool = False
    disabled_reason: str | None = None  # conflicts with the user's answers
    accessible: bool | None = None
    uses_blocked_line: bool = False
    warnings: list[str] = []
    on_time_probability: float | None = Field(None, ge=0, le=1)  # chance to arrive by preferences.deadline
    # --- added by Prevention (optional, only when AlternativesRequest.include_reliability) ---
    reliability: "TripReliability | None" = None


class AlternativesRequest(BaseModel):
    journey_id: str
    preferences: Preferences = Preferences()
    include_reliability: bool = False  # Prevention: fill Alternative.reliability (a few TomTom calls)


class AlternativesResponse(BaseModel):
    """One ranked list per category, best first."""

    journey_id: str
    by_category: dict[AlternativeCategory, list[Alternative]]


# ---------------------------------------------------------------------------
# Commuter notifications (owner: Frontend, UX & notifications)
# ---------------------------------------------------------------------------

class CommuterTrip(BaseModel):
    id: str | None = None
    user_id: str
    origin_stop_id: str
    destination_stop_id: str
    departure_time: str  # "HH:MM", local time
    weekdays: list[int] = [0, 1, 2, 3, 4]  # Monday = 0
    push_token: str | None = None
    origin_name: str | None = None
    destination_name: str | None = None
    line: str | None = None
    arrival_time: str | None = None


class Notification(BaseModel):
    trip_id: str
    title: str
    body: str
    incident_id: str | None = None
    created_at: datetime
    id: str | None = None
    kind: Literal[
        "earlier_train", "own_train", "resolved",  # commuter alerts
        "booked_train_disrupted", "connection_broken", "connection_at_risk", "booking_back_to_normal",  # booked trips
    ] | None = None
    probability: float | None = Field(None, ge=0, le=1)  # chance the own train is still hit


# ---------------------------------------------------------------------------
# Live situation of the demo incident (presenter controls, single source of truth)
# ---------------------------------------------------------------------------

class SituationUpdate(BaseModel):
    """One published update of the incident (what a traveller would see change)."""

    time: datetime
    text: str


class Situation(BaseModel):
    """Current state of the incident on a demo journey. Status, estimate,
    alternatives and commuter alerts are all computed from it.

    mode "simulated": the presenter sets the values (demo-zh, fictitious incident).
    mode "replay": the values come from the real liveticker / KULT data at `clock`.
    """

    journey_id: str
    incident_id: str
    mode: Literal["simulated", "replay"]
    section: str
    start: datetime
    clock: datetime  # "now" of the demo
    official_end: datetime | None = None
    replacement_bus: bool = False
    resumed_at: datetime | None = None
    updates: list[SituationUpdate] = []
    next_update: datetime | None = None  # replay: next real update after `clock`

    @property
    def resumed(self) -> bool:
        return self.resumed_at is not None and self.resumed_at <= self.clock


class SituationAction(BaseModel):
    """advance: clock += minutes. set_official_end: SBB announces `time`.
    replacement_bus: buses start (value=true) or stop. resume: line reopens now.
    next_update: replay, jump to the next real update. reset: back to the start."""

    action: Literal["advance", "set_official_end", "replacement_bus", "resume", "next_update", "reset"]
    minutes: float | None = None
    time: datetime | None = None
    value: bool | None = None


class LineTrain(BaseModel):
    """A train on the commuter's route around their own departure."""

    departure: datetime
    line: str | None = None
    state: Literal["stuck", "cancelled", "at_risk", "ok"]
    note: str = ""
    yours: bool = False


class CommuterAlert(BaseModel):
    """A notification with everything the alert screen shows, computed when it was sent."""

    notification: Notification
    trip: CommuterTrip
    planned_departure: datetime
    planned_arrival: datetime | None = None
    headline: str
    reasons: list[str] = []
    line: list[LineTrain] = []
    options: list[Alternative] = []


# ---------------------------------------------------------------------------
# Prevention (owner: Prevention). Warn before a delay happens.
# See docs/prevention-frontend-handoff.md for how the app should show these.
# ---------------------------------------------------------------------------

ReliabilityLevel = Literal["good", "fair", "low"]  # UI words: Reliable / Probably fine / Uncertain


class LegReliability(BaseModel):
    """Idea 3: how much a leg usually suffers from road traffic at that hour."""

    mode: str
    line: str | None = None
    from_stop: Stop
    to_stop: Stop
    departure: datetime
    road_exposure: float = Field(ge=0, le=1)  # 1 = bus in mixed traffic, 0 = own track (train, metro)
    typical_congestion_minutes: float = 0.0   # extra car minutes at that hour vs free flow (0 if no road)
    expected_delay_minutes: float = 0.0       # mean delay we expect for this leg
    level: ReliabilityLevel = "good"
    reason: str = ""


class TransferRisk(BaseModel):
    """A change between two vehicles and the chance to miss it."""

    at_stop: Stop
    arrival: datetime            # incoming vehicle
    departure: datetime          # outgoing vehicle
    walk_minutes: float = 0.0
    margin_minutes: float        # departure - arrival - walk
    expected_incoming_delay_minutes: float = 0.0
    probability_missed: float = Field(ge=0, le=1)
    level: ReliabilityLevel = "good"


class TripReliability(BaseModel):
    """Idea 3: reliability gauge of one itinerary, from usual traffic at that hour.

    Show `label` + `reason`, never the numbers (stressed traveller rule)."""

    level: ReliabilityLevel
    label: str                   # "Reliable", "Probably fine", "Uncertain"
    reason: str                  # one short sentence, e.g. "Bus 912 is often slowed by traffic around 17:30"
    expected_delay_minutes: float = 0.0          # mean delay at the destination
    probability_late_5min: float = Field(0.0, ge=0, le=1)  # P(arrive more than 5 min after the planned time)
    on_time_probability: float | None = Field(None, ge=0, le=1)  # P(arrive by the deadline), if one is given
    effective_arrival: datetime | None = None    # planned arrival + safety margin, used to rank
    road_share: float = Field(0.0, ge=0, le=1)   # share of the ride time spent on roads
    legs: list[LegReliability] = []
    transfers: list[TransferRisk] = []
    source: Literal["tomtom_historic", "rush_hour_profile"] = "rush_hour_profile"


class PlannedTrip(BaseModel):
    """One itinerary of a normal search, with its reliability."""

    id: str
    legs: list[Leg]
    departure: datetime
    arrival: datetime
    transfers: int = 0
    reliability: TripReliability
    recommended: bool = False
    note: str | None = None      # e.g. "6 min longer, but avoids buses at rush hour"


class ReliablePlanRequest(BaseModel):
    origin_stop_id: str
    destination_stop_id: str
    departure: datetime
    deadline: datetime | None = None
    num_results: int = Field(5, ge=1, le=8)


class ReliablePlanResponse(BaseModel):
    """Trips ranked by reliability (safest first when there is a deadline)."""

    trips: list[PlannedTrip]
    ranking: str                 # how the list is sorted, for the UI subtitle


class StopForecast(BaseModel):
    stop: Stop
    planned_arrival: datetime
    official_delay_minutes: int = 0   # what SBB / the operator shows now (OJP real-time)
    predicted_delay_minutes: int = 0  # our forecast from the traffic ahead


class SegmentForecast(BaseModel):
    """Road between two stops of the bus, with the traffic right now."""

    from_stop: Stop
    to_stop: Stop
    reached_at: datetime              # when the bus should get there (planned + current delay)
    live_minutes: float | None = None
    typical_minutes: float | None = None
    free_flow_minutes: float | None = None
    added_delay_minutes: float = 0.0  # extra delay this segment adds (after the horizon weight)
    jam: bool = False


class BusDelayForecast(BaseModel):
    """Idea 4: future delay of a bus, from the traffic it will drive through.

    `extra_minutes` > 0 means we see a delay the official real-time data does
    not show yet."""

    line: str | None = None
    from_stop: Stop
    to_stop: Stop
    planned_departure: datetime
    planned_arrival: datetime
    as_of: datetime
    current_delay_minutes: int = 0     # delay reported now
    official_delay_minutes: int = 0    # delay shown now at to_stop
    predicted_delay_minutes: int = 0   # our forecast at to_stop
    extra_minutes: int = 0             # predicted - official
    stops: list[StopForecast] = []
    segments: list[SegmentForecast] = []
    confidence: Literal["high", "medium", "low"] = "low"
    source: Literal["tomtom_live", "simulated", "too_early", "unavailable"] = "unavailable"
    explanation: str = ""


class BusDelayResponse(BaseModel):
    trip_departure: datetime | None = None
    trip_arrival: datetime | None = None
    forecasts: list[BusDelayForecast] = []  # one per bus leg of the trip


class BookedTrip(BaseModel):
    """Idea 2: a trip the traveller already paid for (e.g. a Supersaver ticket)."""

    id: str | None = None
    user_id: str
    origin_stop_id: str
    destination_stop_id: str
    departure: datetime          # booked departure (the app finds the matching connection)
    origin_name: str | None = None
    destination_name: str | None = None
    ticket_kind: Literal["supersaver", "point_to_point", "travelcard"] = "supersaver"
    # filled by the backend at booking time (the connection that was bought)
    legs: list[Leg] = []
    arrival: datetime | None = None
    push_token: str | None = None


class ConnectionCheck(BaseModel):
    """One change of the booked trip, checked with real-time data and forecasts."""

    at_stop: Stop
    arrival: datetime            # incoming vehicle, best estimate (real-time + our bus forecast)
    departure: datetime          # outgoing vehicle, real-time
    margin_minutes: float
    probability_missed: float = Field(ge=0, le=1)
    status: Literal["ok", "at_risk", "broken"]
    cause: str = ""              # e.g. "Bus 912 will probably arrive 7 min late (traffic ahead)"


class BookingAlert(BaseModel):
    """What the booked-trip alert screen shows, computed when it was sent."""

    notification: Notification
    booking: BookedTrip
    headline: str
    reasons: list[str] = []
    connections: list[ConnectionCheck] = []
    bus_forecasts: list[BusDelayForecast] = []
    options: list[Alternative] = []  # other ways to get there, best first
    ticket_note: str | None = None


class BookingStatus(BaseModel):
    """Current check of a booked trip (also when nothing is wrong)."""

    booking: BookedTrip
    as_of: datetime
    state: Literal["ok", "at_risk", "broken", "disrupted", "not_watched"]
    summary: str
    connections: list[ConnectionCheck] = []
    bus_forecasts: list[BusDelayForecast] = []
    reliability: TripReliability | None = None


Alternative.model_rebuild()
AlternativesResponse.model_rebuild()
