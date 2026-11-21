"""Hardcoded demo journey so all three workstreams can run before real data is wired in."""

from datetime import datetime, timedelta

from app.models import Journey, Stop

_now = datetime.now().astimezone().replace(second=0, microsecond=0)

# Real incident replayed in delay mode (same as frontend/src/mocks/scenario.ts and
# the estimation tests): fire Puidoux - Vauderens, 25.09.2026. The journey is the
# frontend's demo journey on that day, so replayed times and journey times match.
DEMO_INCIDENT_ID = "2195005195853"

DEMO_JOURNEY = Journey(
    id="demo-1",
    origin=Stop(id="8501120", name="Lausanne", lat=46.5168, lon=6.6291),
    destination=Stop(id="8507000", name="Bern", lat=46.949, lon=7.4391),
    departure=datetime.fromisoformat("2026-09-25T17:20:00+02:00"),
    arrival=datetime.fromisoformat("2026-09-25T18:26:00+02:00"),
    line="IC 1",
)


def _next_weekday_at(hour: int, minute: int) -> datetime:
    """Today at hh:mm if it is a weekday and not past yet, else the next weekday."""
    t = _now.replace(hour=hour, minute=minute)
    while t.weekday() >= 5 or t < _now:
        t = (t + timedelta(days=1)).replace(hour=hour, minute=minute)
    return t


# Agreed demo scenario (routing): weekday return commute, S14 Zürich HB -> Hinwil,
# interrupted between Uster and Wetzikon ZH (see app/routing/disruption.py).
_zh_dep = _next_weekday_at(17, 42)
DEMO_JOURNEY_ZH = Journey(
    id="demo-zh",
    origin=Stop(id="8503000", name="Zürich HB", lat=47.37818, lon=8.54019),
    destination=Stop(id="8503130", name="Hinwil", lat=47.30006, lon=8.83972),
    departure=_zh_dep,
    arrival=_zh_dep + timedelta(minutes=40),
    line="S14",
)

JOURNEYS = {j.id: j for j in (DEMO_JOURNEY, DEMO_JOURNEY_ZH)}


def get_journey(journey_id: str) -> Journey:
    # TODO: replace with a real lookup (OJP or the user's saved journey)
    return JOURNEYS.get(journey_id, DEMO_JOURNEY)
