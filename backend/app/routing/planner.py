"""Collect candidate trips around a blocked section with a handful of OJP calls.

Searches (run in parallel, ~10-14 OJP calls in total, cached 45 s):
- base search origin -> destination (finds the planned route and where it
  enters the blocked section);
- the same search with ``NotVia`` = section entry stop (e.g. S3 via
  Effretikon / Pfäffikon ZH instead of S14 via Uster);
- one ``Via`` search per detour hub of the scenario (e.g. via Rapperswil);
- trips to the closest stations within the destination radius;
- trip to the section entry + a replacement bus over the section (timed with
  TomTom when a key is set) + trip from the section exit to the destination;
- "wait": the planned route after the announced reopening.

Every candidate that still runs through the section is dropped from the
detour lists; those trips are only offered as "wait".
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from app.models import Journey, Preferences, Stop
from app.routing import service_points as sp
from app.routing.disruption import (
    DisruptionContext,
    entry_and_exit,
    section_calls,
    trip_uses_section,
)
from app.routing.ojp_client import OJPCall, OJPClient, OJPError, OJPLeg, OJPTrip
from app.routing.road_traffic import road_time

log = logging.getLogger(__name__)

AT_DESTINATION_KM = 0.6  # a stop this close counts as "the destination"
RADIUS_STOPS = 6  # OJP searches to stops within the radius (quota!)
REPLACEMENT_TRANSFER = timedelta(minutes=5)  # walk to the bus + wait
REPLACEMENT_BUS_SPEED_KMH = 25  # fallback when TomTom is not available


@dataclass
class Candidate:
    trip: OJPTrip
    source: str  # base, detour, via:<id>, radius:<id>, replacement_bus, wait, wait_margin
    final_stop: Stop
    distance_km: float

    @property
    def at_destination(self) -> bool:
        return self.distance_km <= AT_DESTINATION_KM

    @property
    def uses_replacement_bus(self) -> bool:
        return any(leg.mode == "replacement_bus" for leg in self.trip.legs)

    @property
    def bus_legs(self) -> int:
        return sum(1 for leg in self.trip.pt_legs if leg.mode in ("bus", "replacement_bus"))

    @property
    def walk_minutes(self) -> float:
        return sum((leg.arrival - leg.departure).total_seconds() / 60
                   for leg in self.trip.legs if leg.mode == "walk")


@dataclass
class PlanResult:
    candidates: list[Candidate] = field(default_factory=list)
    wait: list[Candidate] = field(default_factory=list)
    planned_trip: OJPTrip | None = None
    affected: bool = False
    notes: list[str] = field(default_factory=list)


def _stop(stop_id: str, name: str = "") -> Stop:
    return sp.get_stop(stop_id) or Stop(id=stop_id, name=name or stop_id)


def _candidate(trip: OJPTrip, source: str, destination: Stop) -> Candidate:
    last = trip.legs[-1].alight
    final = _stop(last.stop_id, last.name)
    d = sp.distance_km(final, destination)
    return Candidate(trip, source, final, round(d, 2) if d is not None else 0.0)


def _safe(fn, *args, **kwargs) -> list[OJPTrip]:
    try:
        return fn(*args, **kwargs)
    except OJPError as exc:
        log.warning("OJP search failed: %s", exc)
        return []


def plan(journey: Journey, prefs: Preferences, ctx: DisruptionContext | None, client: OJPClient) -> PlanResult:
    origin, dest = journey.origin.id, journey.destination.id
    dep = journey.departure
    result = PlanResult()

    base = client.trip(origin, dest, dep, num_results=6)  # let OJPError propagate: nothing works without it
    if ctx is None:
        result.candidates = [_candidate(t, "base", journey.destination) for t in base]
        result.planned_trip = base[0] if base else None
        return result

    section = ctx.section
    affected_trips = [t for t in base if trip_uses_section(t, section)]
    result.affected = bool(affected_trips)
    result.planned_trip = min(affected_trips or base, key=lambda t: abs((t.departure_planned - dep).total_seconds()),
                              default=None)
    if not affected_trips:
        result.notes.append("The planned route does not use the blocked section.")
        result.candidates = [_candidate(t, "base", journey.destination) for t in base]
        result.wait = []
        return result

    entry, exit_ = entry_and_exit(affected_trips[0], section) or (section.from_stop.id, section.to_stop.id)
    not_via = next((s for s in [entry, *section.intermediate_ids, exit_] if s not in (origin, dest)), None)

    # stations within the radius (not the destination, not inside the blocked section)
    dest_stop = journey.destination
    if dest_stop.lat is None or dest_stop.lon is None:
        dest_stop = _stop(dest_stop.id, dest_stop.name)
    radius_stops: list[tuple[Stop, float]] = []
    if dest_stop.lat is not None and prefs.destination_radius_km > 0:
        radius_stops = sp.pick_radius_candidates(
            dest_stop.lat, dest_stop.lon, prefs.destination_radius_km, limit=RADIUS_STOPS,
            exclude={dest, entry, *section.intermediate_ids},
        )

    with ThreadPoolExecutor(max_workers=8) as pool:
        f_detour = pool.submit(_safe, client.trip, origin, dest, dep, 6, not_via=not_via) if not_via else None
        f_vias = {v: pool.submit(_safe, client.trip, origin, dest, dep, 4, via=v) for v in section.detour_via_ids}
        f_radius = {
            s.id: pool.submit(_safe, client.trip, origin, s.id, dep, 3, not_via=not_via)
            for s, _ in radius_stops
        }
        f_replacement = pool.submit(_replacement_bus_trips, client, journey, ctx, entry, exit_)
        f_wait = pool.submit(_wait_trips, client, journey, ctx, affected_trips[0], entry)

        found: list[Candidate] = []
        if f_detour:
            found += [_candidate(t, "detour", journey.destination) for t in f_detour.result()]
        for v, f in f_vias.items():
            found += [_candidate(t, f"via:{v}", journey.destination) for t in f.result()]
        for sid, f in f_radius.items():
            found += [_candidate(t, f"radius:{sid}", journey.destination) for t in f.result()]
        found += [_candidate(t, "base", journey.destination) for t in base]
        found += [_candidate(t, "replacement_bus", journey.destination) for t in f_replacement.result()]
        result.wait = [_candidate(t, src, journey.destination) for t, src in f_wait.result()]

    earliest = dep - timedelta(minutes=1)
    seen: set = set()
    for c in found:
        if trip_uses_section(c.trip, section) or c.trip.departure < earliest:
            continue
        sig = c.trip.signature()
        if sig in seen:
            continue
        seen.add(sig)
        result.candidates.append(c)
    return result


# ---------------------------------------------------------------------------
# Replacement bus over the blocked section
# ---------------------------------------------------------------------------

def _replacement_bus_trips(
    client: OJPClient, journey: Journey, ctx: DisruptionContext, entry: str, exit_: str
) -> list[OJPTrip]:
    origin, dest = journey.origin.id, journey.destination.id
    if entry == origin:
        to_entry: list[OJPTrip] = []
    else:
        to_entry = [t for t in _safe(client.trip, origin, entry, journey.departure, 2)
                    if not trip_uses_section(t, ctx.section)]
        if not to_entry:
            return []
    first = to_entry[0] if to_entry else None
    bus_dep = (first.arrival if first else journey.departure) + REPLACEMENT_TRANSFER
    entry_stop, exit_stop = _stop(entry), _stop(exit_)

    rt = road_time(entry_stop, exit_stop, bus_dep)
    if rt:
        minutes = rt.minutes_with_traffic * 1.15 + 3  # bus slower than car, + stops
        road_delay = rt.delay_minutes
    else:
        d = sp.distance_km(entry_stop, exit_stop) or 8.0
        minutes = d * 1.3 / REPLACEMENT_BUS_SPEED_KMH * 60 + 3
        road_delay = None
    bus_dep = _ceil_minute(bus_dep)
    bus_arr = _ceil_minute(bus_dep + timedelta(minutes=minutes))
    bus_leg = OJPLeg(
        kind="synthetic",
        mode="replacement_bus",
        pt_mode="bus",
        line="EV",  # Ersatzverkehr
        calls=[
            OJPCall(entry_stop.id, entry_stop.name, dep_planned=bus_dep),
            OJPCall(exit_stop.id, exit_stop.name, arr_planned=bus_arr),
        ],
        departure_planned=bus_dep,
        arrival_planned=bus_arr,
        road_delay_minutes=road_delay,
        situations=[f"Replacement bus {ctx.section.label} (estimated, road traffic included)"],
    )
    legs = (list(first.legs) if first else []) + [bus_leg]
    if exit_ != dest:
        onward = _safe(client.trip, exit_, dest, bus_arr + timedelta(minutes=2), 2)
        onward = [t for t in onward if not trip_uses_section(t, ctx.section)]
        if not onward:
            return []
        legs += onward[0].legs
    return [OJPTrip(id=f"replacement-{entry}-{exit_}", legs=legs)]


def _ceil_minute(t: datetime) -> datetime:
    if t.second or t.microsecond:
        t = t.replace(second=0, microsecond=0) + timedelta(minutes=1)
    return t


# ---------------------------------------------------------------------------
# Wait for reopening
# ---------------------------------------------------------------------------

def _wait_trips(
    client: OJPClient, journey: Journey, ctx: DisruptionContext, planned: OJPTrip, entry: str
) -> list[tuple[OJPTrip, str]]:
    """First trip on the planned route that enters the section after the
    official reopening, and the first one after our conservative estimate."""
    entry_time = _section_entry_time(planned, ctx)
    lead = (entry_time - planned.departure) if entry_time else timedelta()
    out: list[tuple[OJPTrip, str]] = []
    for target, src in ((ctx.reopening_official, "wait"), (ctx.reopening_safe, "wait_margin")):
        if out and target <= ctx.reopening_official:
            continue
        search_from = max(journey.departure, target - lead - timedelta(minutes=1))
        trips = _safe(client.trip, journey.origin.id, journey.destination.id, search_from, 5)
        for t in trips:
            t_in = _section_entry_time(t, ctx)
            if t_in is not None and t_in >= target:
                if not any(t.signature() == o.signature() for o, _ in out):
                    out.append((t, src))
                break
    return out


def _section_entry_time(trip: OJPTrip, ctx: DisruptionContext) -> datetime | None:
    for leg in trip.legs:
        calls = section_calls(leg, ctx.section)
        if len(calls) >= 2:
            return calls[0].time
    return None


def minutes_between(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 60

