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

import re
from datetime import datetime

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from app.estimation import estimator, kult, replay
from app.mock_data import get_journey
from app import situation
from app.routing.disruption import DEMO_SCENARIOS
from app.models import (
    DepartureRisk, DisruptionStatus, IncidentDetails, IncidentTimeline, PublicMessage, ReopeningEstimate, Situation,
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
                               match_explanation="Fictitious demo incident: no internal SBB details.",
                               public_messages=_simulated_messages(sit))
    at = pd.Timestamp(sit.clock)
    details = kult.incident_details(sit.incident_id, at)
    details.public_messages = replay.public_messages(sit.incident_id, at)
    return details


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
    details = kult.incident_details(incident_id, t)
    details.public_messages = replay.public_messages(incident_id, t)
    return details


# ---------------------------------------------------------------------------
# Public messages of the simulated demo incident
# ---------------------------------------------------------------------------

_CLOCK_RE = re.compile(r"\b([01]?\d|2[0-3])[:h.]([0-5]\d)\b")


def _simulated_messages(sit: Situation) -> list[PublicMessage]:
    """Messages of a real incident on the same section, moved to the demo's times.

    - The first real message is shown at the demo's first update; the others keep
      their delay after it.
    - The replacement-bus message only shows while the presenter runs buses (from
      that update), the final message only once the line has reopened.
    - Clock times in the texts move with their message; the announced end becomes
      the one currently set in the demo.
    """
    scenario = DEMO_SCENARIOS.get(sit.journey_id)
    if scenario is None or not scenario.messages_from:
        return []
    real_id = scenario.messages_from
    try:
        msgs = replay.public_messages(real_id)
        h = estimator._history_indexed().loc[real_id]
    except (FileNotFoundError, KeyError):
        return []
    if not msgs:
        return []
    real_end = h["real_end"].to_pydatetime() if pd.notna(h["real_end"]) else None
    announced = h["announced_end_first"].to_pydatetime() if pd.notna(h["announced_end_first"]) else None
    # move by wall-clock time (the real incident may be in summer time, the demo in winter time)
    first = sit.updates[0].time if sit.updates else sit.clock
    tz = first.tzinfo

    def moved(t):
        wall = first.replace(tzinfo=None) + (t.astimezone(tz).replace(tzinfo=None) - msgs[0].time.astimezone(tz).replace(tzinfo=None))
        return wall.replace(tzinfo=tz)
    buses_on = next((u.time for u in reversed(sit.updates) if u.text.startswith("Replacement buses now run")), None)

    out: list[PublicMessage] = []
    for m in msgs:
        is_bus = "replacement bus" in m.title.lower()
        is_final = real_end is not None and m.time >= real_end - pd.Timedelta(minutes=5)
        if is_final:
            if not sit.resumed_at:
                continue
            t = sit.resumed_at
        elif is_bus:
            if not sit.replacement_bus or buses_on is None:
                continue
            t = buses_on
        else:
            t = moved(m.time)
        if t > sit.clock:
            continue
        # the machine translation of the first title is poor ("Uninterrupted ..." for "Unterbruch")
        title = f"Interruption {sit.section}" if m is msgs[0] else m.title
        out.append(m.model_copy(update={"time": t, "title": title,
                                        "text": _move_times(m.text, m.time, t, announced, sit.official_end)}))
    return sorted(out, key=lambda m: m.time)


def _move_times(text: str, real_time, new_time, announced, official_end) -> str:
    """Move the hh:mm in a message with it (the announced end becomes the demo's)."""
    tz = new_time.tzinfo

    def sub(match: re.Match) -> str:
        hh, mm = int(match.group(1)), int(match.group(2))
        local_real = real_time
        if announced is not None and (hh, mm) == (announced.hour, announced.minute) and official_end is not None:
            return official_end.astimezone(tz).strftime("%H:%M")
        t_real = local_real.replace(hour=hh, minute=mm, second=0, microsecond=0)
        return (new_time + (t_real - local_real)).astimezone(tz).strftime("%H:%M")

    return _CLOCK_RE.sub(sub, text)
