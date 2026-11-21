"""Live situation of the incident on each demo journey: the single source of truth.

The presenter changes it (``POST /situation/{journey_id}``); the journey status,
the reopening estimate, the alternatives and the commuter alerts are all
computed from it, so they always agree with each other.

- ``demo-zh`` (simulated): fictitious interruption Uster - Wetzikon ZH. The
  presenter moves the clock, changes the time announced by SBB, starts or stops
  replacement buses and reopens the line. Each change is a published update.
- ``demo-1`` (replay): real incident from the liveticker. Only the clock moves;
  the announced end, the replacement buses (KULT ticker) and the reopening come
  from the data at that moment.

In memory: one presenter, one demo at a time.
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta

import pandas as pd

from app.mock_data import DEMO_INCIDENT_ID, JOURNEYS
from app.models import Journey, Situation, SituationAction, SituationUpdate

log = logging.getLogger(__name__)

_LOCK = threading.Lock()
_STATE: dict[str, Situation] = {}
_VERSION = 0  # bumped on every change (frontend and watcher use it to refresh)

# Real incident replayed on each replay journey
REPLAY_INCIDENTS = {"demo-1": DEMO_INCIDENT_ID}


def _hm(t: datetime | None) -> str:
    return t.astimezone().strftime("%H:%M") if t else "?"


# ---------------------------------------------------------------------------
# Building the initial state
# ---------------------------------------------------------------------------

def _simulated_initial(journey: Journey) -> Situation:
    from app.routing.disruption import DEMO_SCENARIOS
    from app.routing.service_points import get_stop

    sc = DEMO_SCENARIOS[journey.id]
    names = []
    for stop_id in (sc.section_from, sc.section_to):
        try:
            stop = get_stop(stop_id)
        except Exception:  # service points not downloadable
            stop = None
        names.append(stop.name if stop else stop_id)
    section = f"{names[0]} - {names[1]}"
    start = sc.start(journey)
    clock = sc.now(journey)
    official_end = sc.official_end(journey)
    return Situation(
        journey_id=journey.id, incident_id=sc.incident_id, mode="simulated", section=section,
        start=start, clock=clock, official_end=official_end,
        updates=[SituationUpdate(time=clock, text=f"No trains between {section}. "
                                                   f"SBB expects trains again around {_hm(official_end)}.")],
    )


def _replay_initial(journey: Journey) -> Situation:
    from app.estimation import estimator

    incident_id = REPLAY_INCIDENTS[journey.id]
    from app.estimation import replay

    h = estimator._history_indexed().loc[incident_id]
    start = h["start"].to_pydatetime()
    points = replay.timeline(incident_id).points
    clock = points[0].time if points else start  # the first public message
    sit = Situation(journey_id=journey.id, incident_id=incident_id, mode="replay", section=str(h["section"]),
                    start=start, clock=clock)
    return _refresh_replay(sit)


def _refresh_replay(sit: Situation) -> Situation:
    """Values of a replayed incident at `sit.clock`, from the real data."""
    from app.estimation import kult, replay

    t = pd.Timestamp(sit.clock)
    tl = replay.timeline(sit.incident_id)
    known = [p for p in tl.points if p.time <= sit.clock]
    later = [p for p in tl.points if p.time > sit.clock]
    current = known[-1] if known else (tl.points[0] if tl.points else None)
    resumed = tl.real_end if tl.real_end is not None and tl.real_end <= sit.clock else None
    try:
        details = kult.incident_details(sit.incident_id, t)
        buses = bool(details.replacement_buses)
    except Exception as exc:  # KULT data missing
        log.warning("No KULT details for %s: %s", sit.incident_id, exc)
        buses = False
    return sit.model_copy(update={
        "official_end": current.official_end if current else None,
        "replacement_bus": buses and resumed is None,
        "resumed_at": resumed,
        "updates": [SituationUpdate(time=p.time, text=p.what_changed or p.title) for p in known],
        "next_update": later[0].time if later else None,
    })


def _initial(journey_id: str) -> Situation | None:
    from app.routing.disruption import DEMO_SCENARIOS

    journey = JOURNEYS.get(journey_id)
    if journey is None:
        return None
    if journey_id in DEMO_SCENARIOS:
        return _simulated_initial(journey)
    if journey_id in REPLAY_INCIDENTS:
        try:
            return _replay_initial(journey)
        except (FileNotFoundError, KeyError) as exc:
            log.warning("Cannot replay %s: %s", journey_id, exc)
    return None


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def get(journey_id: str) -> Situation | None:
    with _LOCK:
        if journey_id not in _STATE:
            sit = _initial(journey_id)
            if sit is None:
                return None
            _STATE[journey_id] = sit
        return _STATE[journey_id]


def all_situations() -> list[Situation]:
    return [s for s in (get(j) for j in JOURNEYS) if s is not None]


def version() -> int:
    return _VERSION


class ActionError(ValueError):
    pass


def apply(journey_id: str, action: SituationAction) -> Situation:
    global _VERSION
    sit = get(journey_id)
    if sit is None:
        raise KeyError(journey_id)
    if action.action == "reset":
        new = _initial(journey_id)
    elif sit.mode == "replay":
        new = _apply_replay(sit, action)
    else:
        new = _apply_simulated(sit, action)
    with _LOCK:
        _STATE[journey_id] = new
        _VERSION += 1
    return new


def _apply_replay(sit: Situation, a: SituationAction) -> Situation:
    if a.action == "advance":
        sit = sit.model_copy(update={"clock": sit.clock + timedelta(minutes=a.minutes or 10)})
    elif a.action == "next_update":
        if sit.next_update is None:
            raise ActionError("No later update in the data")
        sit = sit.model_copy(update={"clock": sit.next_update})
    else:
        raise ActionError("A replayed incident follows the real data: only the time can change")
    return _refresh_replay(sit)


def _apply_simulated(sit: Situation, a: SituationAction) -> Situation:
    updates = list(sit.updates)
    if a.action == "advance":
        return sit.model_copy(update={"clock": sit.clock + timedelta(minutes=a.minutes or 10)})
    if sit.resumed:
        raise ActionError("The line has reopened: reset the demo to start again")
    if a.action == "set_official_end":
        if a.time is None:
            raise ActionError("set_official_end needs a time")
        new_end = a.time if a.time.tzinfo else a.time.replace(tzinfo=sit.clock.tzinfo)
        if new_end <= sit.clock:
            raise ActionError("The announced end must be after the current time")
        old = sit.official_end
        updates.append(SituationUpdate(time=sit.clock, text=(
            f"SBB moved the expected reopening from ~{_hm(old)} to ~{_hm(new_end)}" if old
            else f"SBB expects trains again around {_hm(new_end)}")))
        return sit.model_copy(update={"official_end": new_end, "updates": updates})
    if a.action == "replacement_bus":
        on = bool(a.value)
        if on == sit.replacement_bus:
            return sit
        updates.append(SituationUpdate(time=sit.clock, text=(
            f"Replacement buses now run between {sit.section}" if on
            else f"Replacement buses no longer run between {sit.section}")))
        return sit.model_copy(update={"replacement_bus": on, "updates": updates})
    if a.action == "resume":
        updates.append(SituationUpdate(time=sit.clock, text=f"Service resumed at {_hm(sit.clock)}"))
        return sit.model_copy(update={"resumed_at": sit.clock, "replacement_bus": False, "updates": updates})
    raise ActionError(f"Action {a.action!r} is not available for a simulated incident")


def latest_changes(sit: Situation) -> list[str]:
    """Texts of the most recent updates (what changed since the previous version), newest first."""
    if len(sit.updates) < 2:
        return []
    last = sit.updates[-1].time
    return [u.text for u in reversed(sit.updates[1:]) if u.time == last]  # newest first
