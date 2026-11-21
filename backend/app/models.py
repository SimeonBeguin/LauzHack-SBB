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


class AlternativesRequest(BaseModel):
    journey_id: str
    preferences: Preferences = Preferences()


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
    kind: Literal["earlier_train", "own_train", "resolved"] | None = None
    probability: float | None = Field(None, ge=0, le=1)  # chance the own train is still hit
