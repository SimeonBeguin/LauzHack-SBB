"""Idea 4: predict the delay of a bus from the traffic it is about to drive through.

Official real-time data only shows a delay once the bus *has* lost time, and
then carries it unchanged to the next stops. Here we look ahead: for each
road segment the bus still has to drive, we ask TomTom for the travel time
with the traffic *right now* and compare it with the usual time at that hour.
The unusual extra time is the delay the bus will probably pick up there.

    predicted delay at stop k = delay reported now
                              + sum over the segments before k of
                                weight(horizon) * max(0, live - typical)

- live: TomTom travel time with current traffic (no departAt).
- typical: TomTom ``historicTrafficTravelTimeInSeconds`` (the timetable already
  includes the usual rush-hour time), else free flow.
- weight(horizon): a jam seen now is still there in 20 min (weight 1), but we
  stop trusting it after 60 min (weight 0), linear in between.

Limits (say them in the pitch): car time, not bus time (bus lanes and stops
are ignored), and only the part of the line the traveller rides (OJP gives the
calls from the boarding stop). Calibrate HORIZON_* and the jam threshold with
the real-time archive ("Ist-Daten", opentransportdata.swiss) later.

TomTom key: TOMTOM_API_KEY in .env (same as the replacement-bus timing). Without
a key the forecast says "unavailable"; ``simulate_jam_minutes`` makes a jam
for the demo (the result is marked "simulated").
"""

from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import BusDelayForecast, SegmentForecast, Stop, StopForecast
from app.routing.ojp_client import OJPCall, OJPLeg, OJPTrip
from app.routing.road_traffic import RoadTime, road_time

log = logging.getLogger(__name__)

TZ = ZoneInfo("Europe/Zurich")
BUS_MODES = ("bus", "replacement_bus")
HORIZON_FULL_MIN = 20   # a jam seen now is still there this far ahead...
HORIZON_ZERO_MIN = 60   # ...and no longer trusted after this
WATCH_BEFORE_MIN = 60   # live traffic says nothing about a bus that leaves later than this
MAX_SEGMENTS = 6        # TomTom calls per bus leg (consecutive stops are merged)
JAM_RATIO = 1.3         # live >= 1.3 x typical and >= 1 min extra: "jam"
MIN_EXTRA_TO_TELL = 2   # minutes; below this the forecast is "as shown"


def _minutes(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 60


def horizon_weight(minutes_ahead: float) -> float:
    if minutes_ahead <= HORIZON_FULL_MIN:
        return 1.0
    if minutes_ahead >= HORIZON_ZERO_MIN:
        return 0.0
    return (HORIZON_ZERO_MIN - minutes_ahead) / (HORIZON_ZERO_MIN - HORIZON_FULL_MIN)


def _stop(call: OJPCall) -> Stop:
    try:
        from app.routing.service_points import get_stop

        found = get_stop(call.stop_id)
    except Exception:  # service points not available offline
        found = None
    return found or Stop(id=call.stop_id, name=call.name)


def _planned(call: OJPCall) -> datetime | None:
    return call.dep_planned or call.arr_planned


def _delay(call: OJPCall) -> int:
    """Delay (min) shown now at that call by the operator."""
    for est, plan in ((call.arr_estimated, call.arr_planned), (call.dep_estimated, call.dep_planned)):
        if est and plan:
            return max(0, round(_minutes(plan, est)))
    return 0


def _sample(calls: list[OJPCall]) -> list[OJPCall]:
    """At most MAX_SEGMENTS + 1 calls, first and last kept, evenly spread."""
    if len(calls) <= MAX_SEGMENTS + 1:
        return calls
    step = (len(calls) - 1) / MAX_SEGMENTS
    idx = sorted({round(i * step) for i in range(MAX_SEGMENTS + 1)})
    return [calls[i] for i in idx]


def _typical(rt: RoadTime) -> float:
    return rt.minutes_historic if rt.minutes_historic else rt.minutes_free_flow


def forecast_leg(leg: OJPLeg, now: datetime | None = None,
                 simulate_jam_minutes: float | None = None) -> BusDelayForecast:
    """Forecast for one bus leg. `now` defaults to the real time (live traffic is real)."""
    now = now or datetime.now(TZ)
    calls = [c for c in leg.calls if _planned(c) and not c.not_serviced]
    board, alight = _stop(leg.board), _stop(leg.alight)
    official = _delay(leg.alight)
    out = BusDelayForecast(
        line=leg.line, from_stop=board, to_stop=alight,
        planned_departure=leg.departure_planned, planned_arrival=leg.arrival_planned, as_of=now,
        official_delay_minutes=official, predicted_delay_minutes=official,
    )
    if len(calls) < 2:
        out.explanation = "Not enough stops to look ahead."
        return out
    if now >= leg.arrival:
        out.explanation = "The bus has already arrived."
        return out
    if simulate_jam_minutes is None and now < leg.departure_planned - timedelta(minutes=WATCH_BEFORE_MIN):
        out.source = "too_early"
        out.explanation = (f"Traffic is checked from {WATCH_BEFORE_MIN} min before departure: "
                           "today's jams say little about later.")
        return out

    # Where is the bus? Last call it has passed (best time <= now); before boarding: the first call.
    passed = [i for i, c in enumerate(calls) if (c.time or _planned(c)) <= now]
    pos = passed[-1] if passed else 0
    current = _delay(calls[pos])
    out.current_delay_minutes = current
    ahead = _sample(calls[pos:])
    stops = [_stop(c) for c in ahead]
    pairs = list(zip(range(len(ahead) - 1), range(1, len(ahead))))

    # Live traffic for every segment ahead, in parallel (cached 5 min in road_traffic)
    if simulate_jam_minutes is None:
        with ThreadPoolExecutor(max_workers=6) as pool:
            times = list(pool.map(lambda ij: road_time(stops[ij[0]], stops[ij[1]], None), pairs))
        if not any(times):
            out.source = "unavailable"
            out.explanation = "No live traffic (TOMTOM_API_KEY not set or TomTom unreachable)."
            return out
        out.source = "tomtom_live"
    else:
        times = [None] * len(pairs)
        jam_at = len(pairs) // 2  # the demo jam sits in the middle of the ride
        out.source = "simulated"

    added_total = 0.0
    worst: SegmentForecast | None = None
    out.stops.append(StopForecast(stop=stops[0], planned_arrival=_planned(ahead[0]),
                                  official_delay_minutes=_delay(ahead[0]), predicted_delay_minutes=current))
    for k, ((i, j), rt) in enumerate(zip(pairs, times)):
        reached = _planned(ahead[i]) + timedelta(minutes=current + added_total)
        scheduled = max(0.5, _minutes(_planned(ahead[i]), _planned(ahead[j])))
        if out.source == "simulated":
            typical = rt and _typical(rt) or scheduled
            live = typical + (simulate_jam_minutes if k == jam_at else 0.0)
            free = None
        elif rt is None:
            live = typical = free = None
        else:
            live, typical, free = rt.minutes_with_traffic, _typical(rt), rt.minutes_free_flow
        extra = max(0.0, live - typical) if live is not None and typical is not None else 0.0
        added = extra * horizon_weight(max(0.0, _minutes(now, reached)))
        seg = SegmentForecast(
            from_stop=stops[i], to_stop=stops[j], reached_at=reached,
            live_minutes=_r(live), typical_minutes=_r(typical), free_flow_minutes=_r(free),
            added_delay_minutes=round(added, 1),
            jam=bool(live and typical and live >= JAM_RATIO * typical and extra >= 1),
        )
        out.segments.append(seg)
        added_total += added
        if worst is None or seg.added_delay_minutes > worst.added_delay_minutes:
            worst = seg
        out.stops.append(StopForecast(
            stop=stops[j], planned_arrival=_planned(ahead[j]), official_delay_minutes=_delay(ahead[j]),
            predicted_delay_minutes=max(_delay(ahead[j]), round(current + added_total)),
        ))

    out.predicted_delay_minutes = max(official, round(current + added_total))
    out.extra_minutes = out.predicted_delay_minutes - official
    last_reach = max((_minutes(now, s.reached_at) for s in out.segments), default=0)
    out.confidence = ("high" if last_reach <= HORIZON_FULL_MIN else "medium" if last_reach <= 40 else "low")
    if out.source == "simulated":
        out.confidence = "medium"
    line = f"{'Bus' if leg.mode == 'bus' else 'Replacement bus'} {leg.line or ''}".strip()
    if out.extra_minutes >= MIN_EXTRA_TO_TELL and worst is not None:
        out.explanation = (f"Traffic jam between {worst.from_stop.name} and {worst.to_stop.name}: "
                           f"{line} will probably reach {alight.name} {out.predicted_delay_minutes} min late"
                           + (f" (shown now: {official} min)." if official else " (shown now: on time)."))
    else:
        out.explanation = f"No unusual traffic ahead of {line}."
    if out.source == "simulated":
        out.explanation += " [simulated traffic for the demo]"
    return out


def _r(x: float | None) -> float | None:
    return round(x, 1) if x is not None else None


def forecast_trip(trip: OJPTrip, now: datetime | None = None,
                  simulate_jam_minutes: float | None = None) -> list[BusDelayForecast]:
    """One forecast per bus / replacement-bus leg of the trip."""
    return [forecast_leg(leg, now, simulate_jam_minutes) for leg in trip.pt_legs if leg.mode in BUS_MODES]
