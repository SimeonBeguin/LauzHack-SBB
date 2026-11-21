"""Optional: real-time road traffic (TomTom or HERE) to adjust replacement bus times."""

from app.config import settings
from app.models import Leg


def road_delay_minutes(leg: Leg) -> int | None:
    if not (settings.tomtom_api_key or settings.here_api_key):
        return None  # feature off when no key is set
    # TODO: call the routing API between leg.from_stop and leg.to_stop
    raise NotImplementedError
