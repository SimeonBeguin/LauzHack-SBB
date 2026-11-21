"""Hardcoded demo journey so all three workstreams can run before real data is wired in."""

from datetime import datetime, timedelta

from app.models import Journey, Stop

_now = datetime.now().astimezone().replace(second=0, microsecond=0)

DEMO_JOURNEY = Journey(
    id="demo-1",
    origin=Stop(id="8501120", name="Lausanne", lat=46.5168, lon=6.6291),
    destination=Stop(id="8504100", name="Fribourg/Freiburg", lat=46.8032, lon=7.1513),
    departure=_now + timedelta(minutes=10),
    arrival=_now + timedelta(minutes=55),
    line="IR 15",
)

DEMO_INCIDENT_ID = "2195004439194"


def get_journey(journey_id: str) -> Journey:
    # TODO: replace with a real lookup (OJP or the user's saved journey)
    return DEMO_JOURNEY
