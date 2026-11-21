"""Presenter controls: read and change the live situation of a demo journey.

    GET  /situation/{journey_id}           current situation (clock, SBB end, buses, ...)
    POST /situation/{journey_id}           apply an action (see models.SituationAction)
    GET  /stops?q=Zür                      rail stations by name (SBB service points)
"""

from fastapi import APIRouter, HTTPException, Query

from app import situation
from app.models import Situation, SituationAction, Stop

router = APIRouter(tags=["situation"])


@router.get("/situation/{journey_id}", response_model=Situation)
def get_situation(journey_id: str) -> Situation:
    sit = situation.get(journey_id)
    if sit is None:
        raise HTTPException(404, f"No incident on journey {journey_id}")
    return sit


@router.post("/situation/{journey_id}", response_model=Situation)
def change_situation(journey_id: str, action: SituationAction) -> Situation:
    try:
        sit = situation.apply(journey_id, action)
        if action.action == "reset":
            from app.notifications import watcher

            watcher.reset()
        return sit
    except KeyError:
        raise HTTPException(404, f"No incident on journey {journey_id}")
    except situation.ActionError as exc:
        raise HTTPException(409, str(exc))


@router.get("/stops", response_model=list[Stop])
def search_stops(q: str = Query(..., min_length=2), limit: int = Query(8, ge=1, le=30)) -> list[Stop]:
    """Rail stations whose name contains `q` (names starting with `q` first)."""
    from app.routing.service_points import load_service_points

    wanted = q.strip().lower()
    hits = [p for p in load_service_points() if p.is_rail and wanted in p.name.lower()]
    hits.sort(key=lambda p: (not p.name.lower().startswith(wanted), len(p.name), p.name))
    return [p.to_stop() for p in hits[:limit]]
