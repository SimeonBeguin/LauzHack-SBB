"""Journey status and incident endpoints. Owner: Data & estimation.

Journey status (used by the app):
    GET /journeys/{journey_id}/status
        ?minutes_since_start=45     replay moment, minutes after the incident start
        ?at=2026-09-25T17:50+02:00  or an exact moment
        ?live=true                  shift all times so that this moment is "now" (default)
    GET /journeys/{journey_id}/details   internal KULT details ("More details" screen)

Incidents (demo, notifications, routing):
    GET /incidents/demo                  good incidents to replay
    GET /incidents/{id}/timeline         every version + the estimate shown at that time
    GET /incidents/{id}/status?at=...    status of any incident at any moment
    GET /incidents/{id}/risk?departure=07:32&at=...   P(still disrupted when my train leaves)
    GET /incidents/{id}/details?at=...   internal KULT details known at that moment

Without the Daten/ folder the journey endpoints fall back to mock data.
"""

from __future__ import annotations

from datetime import datetime

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.estimation import estimator, kult, replay
from app.mock_data import DEMO_INCIDENT_ID, get_journey
from app.routing.disruption import DEMO_SCENARIOS
from app.models import DepartureRisk, DisruptionStatus, IncidentDetails, IncidentTimeline

router = APIRouter(tags=["disruptions"])

# Which real incident each demo journey replays.
JOURNEY_INCIDENTS = {"demo-1": DEMO_INCIDENT_ID}  # demo-zh: fictitious incident, see DEMO_SCENARIOS


def _incident_for(journey_id: str) -> str:
    # TODO (with Routing): find the live incident affecting a real journey (OJP situations).
    return JOURNEY_INCIDENTS.get(journey_id, DEMO_INCIDENT_ID)


def _check_incident(incident_id: str) -> None:
    try:
        known = incident_id in estimator._history_indexed().index
    except FileNotFoundError:
        raise HTTPException(503, "Data folder Daten/ not found on the server")
    if not known:
        raise HTTPException(404, f"Unknown incident {incident_id}")


def _mock_status(journey_id: str) -> DisruptionStatus:
    return DisruptionStatus(
        incident_id=DEMO_INCIDENT_ID,
        journey_id=journey_id,
        title="MOCK: Interruption Puidoux - Vauderens",
        reason="Fire",
        affected_section="Puidoux - Vauderens",
        estimate=estimator.estimate_reopening("mock-no-data"),
        last_update=datetime.now().astimezone(),
    )


# ---------------------------------------------------------------------------
# Journeys
# ---------------------------------------------------------------------------

@router.get("/journeys/{journey_id}/status", response_model=DisruptionStatus)
def journey_status(
    journey_id: str,
    at: datetime | None = Query(None, description="Replay moment (ISO 8601)"),
    minutes_since_start: float | None = Query(None, ge=0, description="Replay moment, minutes after the incident start"),
    live: bool = Query(True, description="Shift all times so that the replayed moment is now"),
) -> DisruptionStatus:
    journey = get_journey(journey_id)
    scenario = DEMO_SCENARIOS.get(journey.id)
    if scenario:
        return _scenario_status(journey, scenario, at, minutes_since_start)
    incident_id = _incident_for(journey.id)
    try:
        t = replay.resolve_time(incident_id, at, minutes_since_start)
        status = replay.status_at(incident_id, journey.id, t)
        start = estimator._history_indexed().loc[incident_id, "start"]
    except (FileNotFoundError, KeyError):
        return _mock_status(journey.id).model_copy(update={"journey": journey})
    try:
        duration_type = replay._version_at(incident_id, t)["duration_type"]
    except (KeyError, IndexError):
        duration_type = None
    status = status.model_copy(update={
        "estimate": _with_ui_labels(status.estimate, duration_type),
        "journey": journey,
        "started_at": start.to_pydatetime(),
        "kind": "resolved" if status.estimate.ended else _kind_of(status.title),
    })
    return replay.shift_to_now(status, t) if live else status


# How SBB phrases the announced end (liveticker duration_type), for the UI sentence
# "SBB expects trains again <label> 18:00".
_OFFICIAL_LABELS = {
    "UNTIL": "until", "UNTIL_AT_LEAST": "at least until", "UNTIL_APPROX_DATE_TIME": "around",
    "UNTIL_DATE": "until", "UNTIL_AT_LEAST_DATE_TIME": "at least until", "FROM_TO": "until",
}


def _with_ui_labels(e, duration_type: str | None):
    """Fill the optional UI fields of the estimate from what we already know."""
    label = "reopened at" if e.ended else _OFFICIAL_LABELS.get(str(duration_type), "around")
    return e.model_copy(update={
        "official_label": e.official_label or label,
        "margin_until": e.margin_until or (None if e.ended else e.likely_end_latest),
    })


def _kind_of(title: str) -> str:
    return "restriction" if title.lower().startswith(("restriction", "einschränkung")) else "interruption"


def _scenario_status(journey, scenario, at: datetime | None, minutes_since_start: float | None) -> DisruptionStatus:
    """Status of the fictitious demo incident (Zürich HB -> Hinwil, Uster - Wetzikon ZH),
    with the same estimate as the routing (app/routing/disruption.py)."""
    from datetime import timedelta

    from app.routing.service_points import get_stop

    start = scenario.start(journey)
    if at is None:
        at = start + timedelta(minutes=minutes_since_start) if minutes_since_start is not None else scenario.now(journey)
    names = []
    for stop_id in (scenario.section_from, scenario.section_to):
        try:
            stop = get_stop(stop_id)
        except Exception:  # service points not downloadable
            stop = None
        names.append(stop.name if stop else stop_id)
    section = f"{names[0]} - {names[1]}"
    try:
        reason = replay._reason_labels().get(scenario.reason_id, scenario.reason_id)
    except FileNotFoundError:
        reason = scenario.reason_id
    return DisruptionStatus(
        incident_id=scenario.incident_id,
        journey_id=journey.id,
        title=f"Interruption {section}",
        reason=reason,
        affected_section=section,
        estimate=_with_ui_labels(scenario.estimate(journey, at=at), "UNTIL_APPROX_DATE_TIME"),
        last_update=min(at, start + timedelta(minutes=5)),
        kind="interruption",
        started_at=start,
        journey=journey,
    )


@router.get("/journeys/{journey_id}/details", response_model=IncidentDetails)
def journey_details(
    journey_id: str,
    at: datetime | None = None,
    minutes_since_start: float | None = Query(None, ge=0),
) -> IncidentDetails:
    journey = get_journey(journey_id)
    scenario = DEMO_SCENARIOS.get(journey.id)
    if scenario:  # fictitious incident: there is no internal KULT case to show
        return IncidentDetails(incident_id=scenario.incident_id,
                               match_explanation="Fictitious demo incident: no internal SBB details.")
    incident_id = _incident_for(journey.id)
    try:
        t = replay.resolve_time(incident_id, at, minutes_since_start)
    except (FileNotFoundError, KeyError):
        return IncidentDetails(incident_id=incident_id, match_explanation="Data folder not found.")
    return kult.incident_details(incident_id, t)


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
