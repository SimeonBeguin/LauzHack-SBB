"""Commuter trip registration and alerts. Owner: Frontend, UX & notifications.

Alerts are computed from the live situations (app/notifications/watcher.py);
the app polls ``GET /commuters/{user_id}/alerts``.
"""

import logging
from datetime import timedelta

from fastapi import APIRouter

from app import situation as situations
from app.models import CommuterAlert, CommuterTrip, Notification
from app.notifications import subscriptions, watcher
from app.routing.ojp_client import OJPClient, OJPError
from app.routing.service_points import get_stop

log = logging.getLogger(__name__)

router = APIRouter(prefix="/commuters", tags=["notifications"])


def _complete(trip: CommuterTrip) -> CommuterTrip:
    """Fill names, line and arrival from the timetable (the usual train on the demo day)."""
    for attr, stop_id in (("origin_name", trip.origin_stop_id), ("destination_name", trip.destination_stop_id)):
        if not getattr(trip, attr):
            stop = get_stop(stop_id)
            setattr(trip, attr, stop.name if stop else stop_id)
    sits = situations.all_situations()
    day = max((s.clock for s in sits), default=None)  # the demo day (most recent situation)
    if day is None:
        return trip
    while day.weekday() not in (trip.weekdays or [day.weekday()]):
        day += timedelta(days=1)
    try:
        train = watcher.find_train(trip, watcher._usual_departure(trip, day), OJPClient())
    except OJPError as exc:
        log.warning("Cannot look up the usual train of %s: %s", trip.id, exc)
        return trip
    if train:
        trip.line = next((leg.line for leg in train.pt_legs if leg.line), trip.line)
        trip.departure_time = train.departure_planned.strftime("%H:%M")
        trip.arrival_time = train.arrival_planned.strftime("%H:%M")
    return trip


@router.post("/trips", response_model=CommuterTrip)
def register_trip(trip: CommuterTrip) -> CommuterTrip:
    trip.line, trip.arrival_time = None, None  # always from the timetable
    return subscriptions.add_trip(_complete(trip))


@router.get("/trips", response_model=list[CommuterTrip])
def list_trips(user_id: str | None = None) -> list[CommuterTrip]:
    return subscriptions.list_trips(user_id)


@router.delete("/trips/{trip_id}")
def delete_trip(trip_id: str) -> dict:
    subscriptions.remove_trip(trip_id)
    return {"ok": True}


@router.get("/{user_id}/alerts", response_model=list[CommuterAlert])
def alerts(user_id: str) -> list[CommuterAlert]:
    return watcher.alerts_for(user_id)


@router.get("/{user_id}/notifications", response_model=list[Notification])
def notifications(user_id: str) -> list[Notification]:
    return [a.notification for a in watcher.alerts_for(user_id)]
