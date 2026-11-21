"""The blocked section of a disruption, and how to tell whether a trip uses it.

The OJP planner does not know about our (replayed or fictitious) incident, so
we block the section ourselves:

1. resolve the section ``"Uster - Wetzikon ZH"`` to stop ids, plus the stations
   between the two ends (from a planned train between them);
2. a rail leg is *blocked* if it serves two or more stops of the section
   (both ends, or an end and an intermediate stop) while the section is closed;
3. the planner (``planner.py``) adds searches that avoid the section
   (``NotVia`` the entry stop, ``Via`` detour hubs, intermediate destinations).

A demo scenario registry gives a fixed incident for the agreed demo
(Zürich HB -> Hinwil, interruption Uster - Wetzikon ZH). For other journeys
the section is read from the disruption status (workstream A).
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache

from app.models import Journey, ReopeningEstimate, Stop
from app.routing.ojp_client import TZ, OJPCall, OJPClient, OJPError, OJPLeg, OJPTrip
from app.routing.service_points import haversine_km

log = logging.getLogger(__name__)


@dataclass
class BlockedSection:
    from_stop: Stop
    to_stop: Stop
    intermediate_ids: list[str] = field(default_factory=list)
    # Optional hubs for "Via" searches around the blocked section (DiDok ids)
    detour_via_ids: list[str] = field(default_factory=list)

    @property
    def stop_ids(self) -> set[str]:
        return {self.from_stop.id, self.to_stop.id, *self.intermediate_ids}

    @property
    def label(self) -> str:
        return f"{self.from_stop.name} - {self.to_stop.name}"


@dataclass
class DisruptionContext:
    incident_id: str
    section: BlockedSection
    start: datetime
    estimate: ReopeningEstimate

    @property
    def reopening_official(self) -> datetime:
        """Headline time (SBB). Falls back to our latest estimate, then +1 h."""
        return (
            self.estimate.official_end
            or self.estimate.likely_end_latest
            or self.start + timedelta(hours=1)
        )

    @property
    def reopening_safe(self) -> datetime:
        """Conservative reopening used to block trips (latest plausible end)."""
        return max(filter(None, [self.estimate.likely_end_latest, self.reopening_official]))

    def is_closed_at(self, t: datetime) -> bool:
        return self.start <= t < self.reopening_safe


# ---------------------------------------------------------------------------
# Blocking logic
# ---------------------------------------------------------------------------

def section_calls(leg: OJPLeg, section: BlockedSection) -> list[OJPCall]:
    """Calls of a rail leg that belong to the section (in travel order).

    Trains that run through the section without stopping (e.g. an IC passing
    Palézieux and Romont) are caught geometrically: if two consecutive stops
    of the leg "frame" both section ends (detour ratio < 1.15), we return two
    synthetic calls for the section ends with the times of those stops.
    """
    if leg.kind != "timed" or leg.pt_mode not in ("rail", None) or leg.mode == "replacement_bus":
        return []
    ids = section.stop_ids
    calls = [c for c in leg.calls if c.stop_id in ids]
    if len(calls) >= 2:
        return calls
    a, b = _coords(section.from_stop), _coords(section.to_stop)
    if not a or not b:
        return calls
    ab = haversine_km(*a, *b)
    for prev, nxt in zip(leg.calls, leg.calls[1:]):
        p, n = _coords_id(prev.stop_id), _coords_id(nxt.stop_id)
        if not p or not n:
            continue
        direct = haversine_km(*p, *n)
        if direct < ab:
            continue
        fwd = haversine_km(*p, *a) + ab + haversine_km(*b, *n)
        bwd = haversine_km(*p, *b) + ab + haversine_km(*a, *n)
        if min(fwd, bwd) <= 1.15 * direct:
            first, second = (section.from_stop, section.to_stop) if fwd <= bwd else (section.to_stop, section.from_stop)
            return [
                OJPCall(first.id, first.name, dep_planned=prev.dep_planned, dep_estimated=prev.dep_estimated),
                OJPCall(second.id, second.name, arr_planned=nxt.arr_planned, arr_estimated=nxt.arr_estimated),
            ]
    return calls


def _coords(stop: Stop) -> tuple[float, float] | None:
    if stop.lat is not None and stop.lon is not None:
        return stop.lat, stop.lon
    return _coords_id(stop.id)


def _coords_id(stop_id: str) -> tuple[float, float] | None:
    from app.routing.service_points import get_service_point

    try:
        sp = get_service_point(stop_id)
    except Exception:  # service points not downloadable
        return None
    return (sp.lat, sp.lon) if sp else None


def leg_uses_section(leg: OJPLeg, section: BlockedSection) -> bool:
    return len(section_calls(leg, section)) >= 2


def leg_is_blocked(leg: OJPLeg, ctx: DisruptionContext) -> bool:
    calls = section_calls(leg, ctx.section)
    if len(calls) < 2:
        return False
    # time the train enters / leaves the section
    t_in = calls[0].time or leg.departure
    t_out = calls[-1].arrival or calls[-1].time or leg.arrival
    return ctx.is_closed_at(t_in) or ctx.is_closed_at(t_out) or (t_in < ctx.start < t_out)


def trip_is_blocked(trip: OJPTrip, ctx: DisruptionContext) -> bool:
    return any(leg_is_blocked(leg, ctx) for leg in trip.legs)


def trip_uses_section(trip: OJPTrip, section: BlockedSection) -> bool:
    return any(leg_uses_section(leg, section) for leg in trip.legs)


def entry_and_exit(trip: OJPTrip, section: BlockedSection) -> tuple[str, str] | None:
    """(entry stop id, exit stop id) of the section in the trip's travel direction."""
    for leg in trip.legs:
        calls = section_calls(leg, section)
        if len(calls) >= 2:
            ends = {section.from_stop.id, section.to_stop.id}
            in_ends = [c.stop_id for c in calls if c.stop_id in ends]
            entry = in_ends[0] if in_ends else calls[0].stop_id
            exit_ = in_ends[-1] if len(in_ends) > 1 else calls[-1].stop_id
            return entry, exit_
    return None


# ---------------------------------------------------------------------------
# Building a section from names or ids
# ---------------------------------------------------------------------------

def resolve_stop(client: OJPClient, name_or_id: str) -> Stop | None:
    """Stop from a DiDok id or a station name ("Romont" -> "Romont FR"), rail stations first."""
    from app.routing.service_points import get_service_point, get_stop, load_service_points

    if name_or_id.isdigit():
        return get_stop(name_or_id) or Stop(id=name_or_id, name=name_or_id)
    wanted = name_or_id.strip().lower()
    try:
        points = load_service_points()
    except Exception as exc:  # no network on first download
        log.warning("Service points unavailable: %s", exc)
        points = ()
    exact = [p for p in points if p.name.lower() == wanted]
    prefix = [p for p in points if p.is_rail and p.name.lower().startswith(wanted + " ")]
    for group in (sorted(exact, key=lambda p: not p.is_rail), prefix):
        if group:
            return group[0].to_stop()
    try:
        candidates = client.location_information(name_or_id, num_results=5)
    except OJPError as exc:
        log.warning("Cannot resolve stop %r: %s", name_or_id, exc)
        return None
    for s in candidates:
        sp = get_service_point(s.id)
        if sp and sp.is_rail:
            return s
    return candidates[0] if candidates else None


@lru_cache(maxsize=64)
def _intermediates_cached(from_id: str, to_id: str, day: str) -> tuple[str, ...]:
    client = OJPClient()
    when = datetime.fromisoformat(f"{day}T10:00:00").replace(tzinfo=TZ)
    try:
        trips = client.trip(from_id, to_id, when, num_results=3)
    except OJPError as exc:
        log.warning("Cannot fetch section stops %s-%s: %s", from_id, to_id, exc)
        return ()
    for trip in trips:
        for leg in trip.pt_legs:
            if leg.pt_mode == "rail" and leg.board.stop_id == from_id and leg.alight.stop_id == to_id:
                return tuple(c.stop_id for c in leg.calls[1:-1])
    return ()


def build_section(
    client: OJPClient, from_name: str, to_name: str, day: datetime, detour_via_ids: list[str] | None = None
) -> BlockedSection | None:
    a, b = resolve_stop(client, from_name), resolve_stop(client, to_name)
    if not a or not b:
        return None
    mids = list(_intermediates_cached(a.id, b.id, day.date().isoformat()))
    return BlockedSection(a, b, mids, list(detour_via_ids or []))


_SECTION_RE = re.compile(r"^\s*(.+?)\s+[-–—]\s+(.+?)\s*$")


def parse_section_text(text: str | None) -> tuple[str, str] | None:
    """``"Uster - Wetzikon ZH"`` -> ("Uster", "Wetzikon ZH")."""
    if not text:
        return None
    text = re.sub(r"^(Interruption|Restriction|Unterbruch|Einschränkung)\s*:?\s*", "", text.strip(), flags=re.I)
    m = _SECTION_RE.match(text)
    return (m.group(1), m.group(2)) if m else None


# ---------------------------------------------------------------------------
# Demo scenario (agreed with the team)
# ---------------------------------------------------------------------------

DEMO_ZH_INCIDENT_ID = "demo-uster-wetzikon"


@dataclass
class DemoScenario:
    incident_id: str
    section_from: str
    section_to: str
    detour_via_ids: list[str]
    starts_before_departure: timedelta  # incident began this long before the planned departure
    official_duration: timedelta  # SBB announced end = start + this
    reason_id: str = "EG_010"  # cause code for the estimate (EG_010 = infrastructure fault)
    checked_before_departure: timedelta = timedelta(minutes=10)  # "now" of the scenario

    def start(self, journey: Journey) -> datetime:
        return journey.departure - self.starts_before_departure

    def official_end(self, journey: Journey) -> datetime:
        return self.start(journey) + self.official_duration

    def now(self, journey: Journey) -> datetime:
        return journey.departure - self.checked_before_departure

    def estimate(self, journey: Journey, at: datetime | None = None) -> ReopeningEstimate:
        """Estimate from workstream A for this fictitious live incident (shared by
        the status endpoint and the routing, so both show the same times)."""
        from app.estimation.estimator import estimate_live

        return estimate_live(self.reason_id, self.start(journey), official_end=self.official_end(journey),
                             at=at or self.now(journey))


DEMO_SCENARIOS: dict[str, DemoScenario] = {
    # Weekday ~17:30 return commute Zürich HB -> Hinwil, S14 interrupted Uster - Wetzikon ZH
    "demo-zh": DemoScenario(
        incident_id=DEMO_ZH_INCIDENT_ID,
        section_from="8503125",  # Uster
        section_to="8503123",  # Wetzikon ZH
        detour_via_ids=["8503110"],  # Rapperswil (S7 / S5 around the lake, then S15/S5 to Wetzikon)
        starts_before_departure=timedelta(minutes=15),
        official_duration=timedelta(minutes=75),
    ),
}


def get_disruption(journey: Journey, client: OJPClient | None = None) -> DisruptionContext | None:
    """Disruption affecting this journey, or None if we cannot find one."""
    client = client or OJPClient()
    scenario = DEMO_SCENARIOS.get(journey.id)
    if scenario:
        section = build_section(client, scenario.section_from, scenario.section_to, journey.departure,
                                scenario.detour_via_ids)
        if section is None:
            return None
        return DisruptionContext(scenario.incident_id, section, scenario.start(journey), scenario.estimate(journey))

    # Generic path: read the affected section from workstream A's status endpoint.
    try:
        from app.api.disruptions import journey_status

        # Call with explicit values: the defaults of the endpoint are FastAPI Query objects.
        status = journey_status(journey.id, at=None, minutes_since_start=None, live=False)
    except Exception as exc:  # status not available for this journey
        log.warning("No disruption status for %s: %s", journey.id, exc)
        return None
    names = parse_section_text(status.affected_section) or parse_section_text(status.title)
    if not names:
        return None
    section = build_section(client, names[0], names[1], journey.departure)
    if section is None:
        return None
    start = status.started_at or min(status.last_update, journey.departure) - timedelta(minutes=30)
    return DisruptionContext(status.incident_id, section, start, status.estimate)
