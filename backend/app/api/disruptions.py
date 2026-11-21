"""Journey status and incident endpoints. Owner: Data & estimation.

Journey status (used by the app), at the current moment of the journey's
situation (app/situation.py, moved by the presenter controls):
    GET /journeys/{journey_id}/status
    GET /journeys/{journey_id}/details   internal KULT details ("More details" screen)

Incidents (demo, notifications, routing):
    GET /incidents/demo                  good incidents to replay
    GET /incidents/{id}/timeline         every version + the estimate shown at that time
    GET /incidents/{id}/status?at=...    status of any incident at any moment
    GET /incidents/{id}/risk?departure=07:32&at=...   P(still disrupted when my train leaves)
    GET /incidents/{id}/details?at=...   internal KULT details known at that moment
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.estimation import estimator, kult, replay
from app.mock_data import get_journey
from app import situation
from app.routing.disruption import DEMO_SCENARIOS
from app.models import (
    DepartureRisk, DisruptionStatus, IncidentDetails, IncidentTimeline, ReopeningEstimate, Situation,
)

router = APIRouter(tags=["disruptions"])

def _check_incident(incident_id: str) -> None:
    try:
        known = incident_id in estimator._history_indexed().index
    except FileNotFoundError:
        raise HTTPException(503, "Data folder Daten/ not found on the server")
    if not known:
        raise HTTPException(404, f"Unknown incident {incident_id}")


# ---------------------------------------------------------------------------
# Journeys
# ---------------------------------------------------------------------------

@router.get("/journeys/{journey_id}/status", response_model=DisruptionStatus)
def journey_status(journey_id: str) -> DisruptionStatus:
    """Status of the journey at the current moment of its situation (see app/situation.py)."""
    journey = get_journey(journey_id)
    sit = situation.get(journey.id)
    if sit is None:
        raise HTTPException(404, f"No incident on journey {journey.id} (or the Daten/ folder is missing)")
    return status_from_situation(sit, journey)


def status_from_situation(sit: Situation, journey) -> DisruptionStatus:
    changes = situation.latest_changes(sit)
    last_update = sit.updates[-1].time if sit.updates else sit.clock
    if sit.mode == "replay":
        t = pd.Timestamp(sit.clock)
        status = replay.status_at(sit.incident_id, journey.id, t)
        try:
            duration_type = replay._version_at(sit.incident_id, t)["duration_type"]
        except (KeyError, IndexError):
            duration_type = None
        return status.model_copy(update={
            "estimate": _with_ui_labels(status.estimate, duration_type),
            "journey": journey,
            "started_at": sit.start,
            "kind": "resolved" if sit.resumed or status.estimate.ended else _kind_of(status.title),
            "changes": changes,
            "last_update": min(last_update, sit.clock),
        })

    reason_id = DEMO_SCENARIOS[sit.journey_id].reason_id
    try:
        reason = replay._reason_labels().get(reason_id, reason_id)
    except FileNotFoundError:
        reason = reason_id
    return DisruptionStatus(
        incident_id=sit.incident_id,
        journey_id=journey.id,
        title=f"Service resumed: {sit.section}" if sit.resumed else f"Interruption {sit.section}",
        reason=reason,
        affected_section=sit.section,
        estimate=situation_estimate(sit),
        last_update=last_update,
        kind="resolved" if sit.resumed else "interruption",
        started_at=sit.start,
        journey=journey,
        changes=changes,
    )


def situation_estimate(sit: Situation) -> ReopeningEstimate:
    """The reopening estimate for the situation (shared with the routing)."""
    journey = get_journey(sit.journey_id)
    if sit.mode == "replay":
        return status_from_situation(sit, journey).estimate
    if sit.resumed:
        return ReopeningEstimate(
            official_end=sit.resumed_at, likely_end_earliest=sit.resumed_at, likely_end_latest=sit.resumed_at,
            median_end=sit.resumed_at, confidence=1.0, ended=True, as_of=sit.clock, method="ended",
            elapsed_minutes=int((sit.resumed_at - sit.start).total_seconds() // 60),
            explanation=f"Service resumed at {sit.resumed_at.strftime('%H:%M')}.", official_label="reopened at",
        )
    est = estimator.estimate_live(DEMO_SCENARIOS[journey.id].reason_id, sit.start,
                                  official_end=sit.official_end, at=sit.clock)
    return _with_ui_labels(est, "UNTIL_APPROX_DATE_TIME" if sit.official_end else None)


# How SBB phrases the announced end (liveticker duration_type), for the UI sentence
# "SBB expects trains again <label> 18:00".
_OFFICIAL_LABELS = {
    "UNTIL": "until", "UNTIL_AT_LEAST": "at least until", "UNTIL_APPROX_DATE_TIME": "around",
    "UNTIL_DATE": "until", "UNTIL_AT_LEAST_DATE_TIME": "at least until", "FROM_TO": "until",
}


def _with_ui_labels(e: ReopeningEstimate, duration_type: str | None) -> ReopeningEstimate:
    """Fill the optional UI fields of the estimate from what we already know."""
    label = "reopened at" if e.ended else _OFFICIAL_LABELS.get(str(duration_type), "around")
    return e.model_copy(update={
        "official_label": e.official_label or label,
        "margin_until": e.margin_until or (None if e.ended else e.likely_end_latest),
    })


def _kind_of(title: str) -> str:
    return "restriction" if title.lower().startswith(("restriction", "einschränkung")) else "interruption"


@router.get("/journeys/{journey_id}/details", response_model=IncidentDetails)
def journey_details(journey_id: str) -> IncidentDetails:
    """Internal SBB details (KULT ticker) known at the current moment of the situation."""
    journey = get_journey(journey_id)
    sit = situation.get(journey.id)
    if sit is None:
        return IncidentDetails(incident_id="", match_explanation="No incident on this journey.")
    if sit.mode == "simulated":  # fictitious incident: there is no internal KULT case to show
        return IncidentDetails(incident_id=sit.incident_id,
                               match_explanation="Fictitious demo incident: no internal SBB details.")
    return kult.incident_details(sit.incident_id, pd.Timestamp(sit.clock))


# ---------------------------------------------------------------------------
# Incidents
# ---------------------------------------------------------------------------

@router.get("/incidents/demo")
def demo_incidents(limit: int = Query(20, ge=1, le=200)) -> list[dict]:
    try:
        return replay.demo_incidents(limit)
    except FileNotFoundError:
        raise HTTPException(503, "Data folder Daten/ not found on the server")


@router.get("/incidents/{incident_id}/timeline", response_model=IncidentTimeline)
def incident_timeline(incident_id: str) -> IncidentTimeline:
    _check_incident(incident_id)
    return replay.timeline(incident_id)


@router.get("/incidents/{incident_id}/status", response_model=DisruptionStatus)
def incident_status(
    incident_id: str,
    at: datetime | None = None,
    minutes_since_start: float | None = Query(None, ge=0),
    live: bool = False,
) -> DisruptionStatus:
    _check_incident(incident_id)
    t = replay.resolve_time(incident_id, at, minutes_since_start)
    status = replay.status_at(incident_id, journey_id="", at=t)
    return replay.shift_to_now(status, t) if live else status


@router.get("/incidents/{incident_id}/risk", response_model=DepartureRisk)
def departure_risk(
    incident_id: str,
    departure: str = Query(..., description="Train departure: 'HH:MM' (same day as `at`) or ISO 8601"),
    at: datetime | None = None,
    minutes_since_start: float | None = Query(None, ge=0),
) -> DepartureRisk:
    _check_incident(incident_id)
    t = replay.resolve_time(incident_id, at, minutes_since_start)
    try:
        if len(departure) <= 5 and ":" in departure:
            hh, mm = (int(x) for x in departure.split(":"))
            dep = t.normalize() + pd.Timedelta(hours=hh, minutes=mm)
            if dep < t - pd.Timedelta(hours=12):
                dep += pd.Timedelta(days=1)
        else:
            dep = estimator._ts(departure)
    except ValueError:
        raise HTTPException(422, "departure must be 'HH:MM' or an ISO 8601 datetime")
    return estimator.departure_risk(incident_id, dep, at=t)


@router.get("/incidents/{incident_id}/details", response_model=IncidentDetails)
def incident_details(
    incident_id: str,
    at: datetime | None = None,
    minutes_since_start: float | None = Query(None, ge=0),
) -> IncidentDetails:
    _check_incident(incident_id)
    t = None
    if at is not None or minutes_since_start is not None:
        t = replay.resolve_time(incident_id, at, minutes_since_start)
    return kult.incident_details(incident_id, t)
