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


class ProbabilityPoint(BaseModel):
    """There is a `p` chance the line has reopened before `before`."""

    before: datetime
    p: float = Field(ge=0, le=1)


class ReopeningEstimate(BaseModel):
    """Official SBB time is the headline. Our statistics only add a margin
    around it and must never contradict it."""

    official_end: datetime | None = Field(None, description="End time published by SBB, if any")
    official_label: str | None = None  # how SBB phrases it: "around", "at least until", "until"
    likely_end_earliest: datetime | None = None
    likely_end_latest: datetime | None = None
    confidence: float | None = Field(None, ge=0, le=1)
    similar_incidents_count: int = 0
    explanation: str = ""  # short human text, e.g. "Based on 34 similar incidents"
    probabilities: list[ProbabilityPoint] = []  # cumulative, sorted by time
    margin_until: datetime | None = None  # "plan a margin until ..."
    reliability: Literal["good", "fair", "low"] | None = None


class IncidentDetails(BaseModel):
    """Internal SBB information (KULT ticker), shown on demand in the UI."""

    source: str = "SBB operations (internal ticker)"
    summary: str = ""
    cancelled_trains: list[str] = []
    replacement_bus: list[str] = []
    recommendation: str | None = None
    ticket_rules: str | None = None


class DisruptionStatus(BaseModel):
    incident_id: str
    journey_id: str
    title: str
    reason: str | None = None
    affected_section: str | None = None
    estimate: ReopeningEstimate
    last_update: datetime
    kind: Literal["interruption", "restriction", "resolved"] = "interruption"
    started_at: datetime | None = None
    journey: Journey | None = None
    changes: list[str] = []  # what changed since the previous version
    details: IncidentDetails | None = None


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
    mode: str  # "train", "bus", "replacement_bus", "walk", "tram", "wait"
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
    title: str | None = None  # "Via Neuchâtel"
    subtitle: str | None = None  # "IC 5 → RE · 1 transfer"
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
