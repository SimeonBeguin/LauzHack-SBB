"""Optional: real-time road traffic (TomTom) to time replacement bus legs.

Replacement buses have no reliable timetable and no real-time data, so we
ask TomTom for the car travel time with current (or predicted) traffic and
compare it with free flow. Limit: car time, not bus time, so callers add a
margin for stops. HERE is not implemented (TomTom is enough for the demo).

The key is sent as a query parameter (TomTom API design): never log URLs.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from app.config import settings
from app.models import Leg, Stop
from app.routing.ojp_client import TTLCache

log = logging.getLogger(__name__)

TOMTOM_URL = "https://api.tomtom.com/routing/1/calculateRoute/{a}:{b}/json"
_cache = TTLCache(ttl_s=300)


@dataclass
class RoadTime:
    minutes_with_traffic: float
    minutes_free_flow: float
    length_km: float

    @property
    def delay_minutes(self) -> int:
        return max(0, round(self.minutes_with_traffic - self.minutes_free_flow))


def road_time(from_stop: Stop, to_stop: Stop, depart_at: datetime | None = None) -> RoadTime | None:
    """Car travel time between two stops (TomTom). None if no key / no coords / error."""
    if not settings.tomtom_api_key:
        return None
    if None in (from_stop.lat, from_stop.lon, to_stop.lat, to_stop.lon):
        return None
    now = datetime.now(timezone.utc)
    # TomTom only accepts departAt in the future; otherwise use live traffic
    depart = depart_at if depart_at and depart_at > now else None
    key = f"{from_stop.id}|{to_stop.id}|{depart.strftime('%Y-%m-%dT%H') if depart else 'now'}"
    cached = _cache.get(key)
    if cached is not None:
        return cached
    params = {
        "key": settings.tomtom_api_key,
        "traffic": "true",
        "travelMode": "bus",
        "computeTravelTimeFor": "all",
        "routeType": "fastest",
    }
    if depart:
        params["departAt"] = depart.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    url = TOMTOM_URL.format(a=f"{from_stop.lat},{from_stop.lon}", b=f"{to_stop.lat},{to_stop.lon}")
    try:
        resp = httpx.get(url, params=params, timeout=10)
        resp.raise_for_status()
        summary = resp.json()["routes"][0]["summary"]
    except (httpx.HTTPError, KeyError, IndexError, ValueError) as exc:
        log.warning("TomTom routing failed: %s", type(exc).__name__)  # no URL: it holds the key
        return None
    traffic_s = summary.get("travelTimeInSeconds")
    free_s = summary.get("noTrafficTravelTimeInSeconds") or traffic_s
    result = RoadTime(traffic_s / 60, free_s / 60, summary.get("lengthInMeters", 0) / 1000)
    _cache.set(key, result)
    return result


def road_delay_minutes(leg: Leg) -> int | None:
    """Extra minutes due to road traffic on a bus / replacement bus leg, or None."""
    if leg.mode not in ("bus", "replacement_bus"):
        return None
    rt = road_time(leg.from_stop, leg.to_stop, leg.departure)
    return rt.delay_minutes if rt else None
