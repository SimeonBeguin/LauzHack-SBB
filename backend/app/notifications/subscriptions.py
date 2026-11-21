"""Store registered commuter trips. In-memory for the hackathon; swap for SQLite if needed."""

import uuid

from app.models import CommuterTrip

_TRIPS: dict[str, CommuterTrip] = {}


def add_trip(trip: CommuterTrip) -> CommuterTrip:
    trip.id = trip.id or uuid.uuid4().hex[:8]
    _TRIPS[trip.id] = trip
    return trip


def list_trips(user_id: str | None = None) -> list[CommuterTrip]:
    return [t for t in _TRIPS.values() if user_id is None or t.user_id == user_id]


def remove_trip(trip_id: str) -> None:
    _TRIPS.pop(trip_id, None)
