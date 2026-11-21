"""Commuter trip registration and alerts. Owner: Frontend, UX & notifications."""

from fastapi import APIRouter

from app.models import CommuterTrip, Notification
from app.notifications import subscriptions

router = APIRouter(prefix="/commuters", tags=["notifications"])


@router.post("/trips", response_model=CommuterTrip)
def register_trip(trip: CommuterTrip) -> CommuterTrip:
    return subscriptions.add_trip(trip)


@router.get("/trips", response_model=list[CommuterTrip])
def list_trips(user_id: str | None = None) -> list[CommuterTrip]:
    return subscriptions.list_trips(user_id)


@router.delete("/trips/{trip_id}")
def delete_trip(trip_id: str) -> dict:
    subscriptions.remove_trip(trip_id)
    return {"ok": True}


@router.get("/{user_id}/notifications", response_model=list[Notification])
def notifications(user_id: str) -> list[Notification]:
    # TODO: return notifications produced by notifications.watcher
    return []
