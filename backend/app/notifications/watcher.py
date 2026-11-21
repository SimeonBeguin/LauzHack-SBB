"""Match live incidents against registered trips and create notifications.

Also alert when an EARLIER train on the same line is hit: that is the early
warning that the commuter's own train will likely be affected.
"""

from app.models import CommuterTrip, Notification


def check_trip(trip: CommuterTrip) -> list[Notification]:
    # TODO: find incidents on the trip's line/section around departure_time,
    # including earlier trains on the same line; build Notification objects.
    raise NotImplementedError


def send_push(notification: Notification, push_token: str) -> None:
    # TODO: Web Push / Expo / browser Notification API, whatever the frontend uses
    raise NotImplementedError
