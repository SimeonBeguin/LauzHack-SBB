"""Idea 3: reliability gauge of an itinerary, from the *usual* traffic at that hour.

Planning time, not live: "at 17:30 on a weekday, this bus is often slowed by
traffic, the train is not". A longer trip on rails can then be ranked before a
shorter one by bus. (Idea 4, bus_delay.py, is the live counterpart.)

Model (simple on purpose, every constant can be calibrated later):

1. Road exposure per mode: bus / replacement bus 1, tram 0.4 (partly own lanes),
   train, metro, funicular, boat 0.
2. Usual congestion of a road leg at its departure time:
   - TomTom routing with ``departAt`` = the leg's departure (future only):
     historic / predictive speeds for that weekday and hour, minus free flow;
   - otherwise a built-in rush-hour profile (``rush_hour_ratio``).
3. Mean delay of a leg = base delay of the mode + 0.6 x exposure x congestion.
   Delays are taken as exponential: P(delay > x) = exp(-x / mean).
4. A change is missed when the incoming delay exceeds the margin
   (next departure - arrival - walk, + 1 min buffer included in OJP times).
5. P(late > 5 min) and P(on time for a deadline) combine 3 and 4; the
   ranking uses an "effective arrival" = arrival + 80th percentile of the
   delay + 20 min x P(missed change).

TODO (data team): replace BASE_DELAY and the profile with the real delay
distribution per line and hour from the real-time archive ("Ist-Daten",
opentransportdata.swiss) - the code keeps the same outputs.
"""

from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app.models import Leg, LegReliability, Stop, TransferRisk, TripReliability
from app.routing.road_traffic import road_time

log = logging.getLogger(__name__)

TZ = ZoneInfo("Europe/Zurich")

ROAD_EXPOSURE = {"bus": 1.0, "replacement_bus": 1.0, "tram": 0.4}
BASE_DELAY = {  # mean delay (min) of a leg without traffic effect
    "train": 1.0, "metro": 0.5, "tram": 1.0, "bus": 1.0, "replacement_bus": 2.5,
    "funicular": 0.5, "cable_car": 0.5, "boat": 1.0,
}
CONGESTION_TO_DELAY = 0.6   # share of the usual car congestion that ends up as bus delay
OJP_BUFFER_MIN = 1.0        # OJP change times already hold about a minute of buffer
MISSED_CHANGE_PENALTY = 20  # minutes added per missed change when ranking
ON_TIME_TOLERANCE = 1.0     # min: a delay under a minute still counts as on time
LABELS = {"good": "Reliable", "fair": "Probably fine", "low": "Uncertain"}
NON_RIDES = ("walk", "wait", "transfer")


def rush_hour_ratio(t: datetime) -> float:
    """Usual car travel time / free flow in Swiss towns at `t` (fallback without TomTom).

    Placeholder profile from common rush hours; replace with measured data."""
    t = t.astimezone(TZ)
    h = t.hour + t.minute / 60
    if t.weekday() == 6:
        return 1.0
    if t.weekday() == 5:
        return 1.15 if 10 <= h < 18 else 1.0
    for start, end, ratio in ((7.0, 8.5, 1.4), (16.5, 18.5, 1.5), (6.5, 7.0, 1.15), (8.5, 9.0, 1.2),
                              (16.0, 16.5, 1.2), (18.5, 19.0, 1.2), (11.5, 13.5, 1.15)):
        if start <= h < end:
            return ratio
    return 1.05


def _minutes(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 60


def _hm(t: datetime) -> str:
    return t.astimezone(TZ).strftime("%H:%M")


def _with_coords(stop: Stop) -> Stop:
    if stop.lat is not None and stop.lon is not None:
        return stop
    try:
        from app.routing.service_points import get_stop

        return get_stop(stop.id) or stop
    except Exception:
        return stop


def _congestion(leg: Leg, now: datetime, use_tomtom: bool) -> tuple[float, str]:
    """(usual extra minutes on the road at that hour, source)."""
    ride = max(1.0, _minutes(leg.departure, leg.arrival))
    if use_tomtom and leg.departure > now:
        rt = road_time(_with_coords(leg.from_stop), _with_coords(leg.to_stop), leg.departure)
        if rt is not None:
            usual = rt.minutes_historic or rt.minutes_with_traffic
            # TomTom routes a car between the two ends; the bus often takes a longer way
            # through villages, so scale the extra time by how much longer the ride is.
            scale = min(1.5, max(0.5, ride / max(1.0, rt.minutes_free_flow * 1.3)))
            return max(0.0, usual - rt.minutes_free_flow) * scale, "tomtom_historic"
    return ride * (rush_hour_ratio(leg.departure) - 1.0), "rush_hour_profile"


def _level(p_ok: float) -> str:
    return "good" if p_ok >= 0.85 else "fair" if p_ok >= 0.65 else "low"


def assess(legs: list[Leg], deadline: datetime | None = None, now: datetime | None = None,
           use_tomtom: bool = True) -> TripReliability:
    """Reliability of one itinerary (legs in travel order, as in Alternative.legs)."""
    now = now or datetime.now(TZ)
    rides = [(i, leg) for i, leg in enumerate(legs) if leg.mode not in NON_RIDES]
    if not rides:
        return TripReliability(level="good", label=LABELS["good"], reason="No vehicle to take.")

    road = [(i, leg) for i, leg in rides if ROAD_EXPOSURE.get(leg.mode, 0) > 0]
    with ThreadPoolExecutor(max_workers=6) as pool:
        cong = dict(zip([i for i, _ in road],
                        pool.map(lambda il: _congestion(il[1], now, use_tomtom), road)))

    leg_out: list[LegReliability] = []
    means: dict[int, float] = {}
    sources = set()
    ride_min = road_min = 0.0
    for i, leg in rides:
        exposure = ROAD_EXPOSURE.get(leg.mode, 0.0)
        c, src = cong.get(i, (0.0, None))
        if src:
            sources.add(src)
        mean = BASE_DELAY.get(leg.mode, 1.0) + CONGESTION_TO_DELAY * exposure * c
        means[i] = mean
        minutes = max(0.0, _minutes(leg.departure, leg.arrival))
        ride_min += minutes
        road_min += minutes * exposure
        p_ok = 1 - math.exp(-5 / mean)
        name = f"{'Bus' if leg.mode == 'bus' else leg.mode.replace('_', ' ').capitalize()} {leg.line or ''}".strip()
        if exposure == 0:
            reason = "Own track, no road traffic"
        elif c >= 3:
            reason = f"{name} is often slowed by traffic around {_hm(leg.departure)}"
        else:
            reason = f"Little road traffic around {_hm(leg.departure)}"
        leg_out.append(LegReliability(
            mode=leg.mode, line=leg.line, from_stop=leg.from_stop, to_stop=leg.to_stop,
            departure=leg.departure, road_exposure=exposure, typical_congestion_minutes=round(c, 1),
            expected_delay_minutes=round(mean, 1), level=_level(p_ok), reason=reason,
        ))

    transfers: list[TransferRisk] = []
    for (i, a), (j, b) in zip(rides, rides[1:]):
        walk = sum(max(0.0, _minutes(x.departure, x.arrival)) for x in legs[i + 1:j] if x.mode == "walk")
        margin = _minutes(a.arrival, b.departure) - walk
        p_miss = 1.0 if margin < 0 else math.exp(-(margin + OJP_BUFFER_MIN) / means[i])
        transfers.append(TransferRisk(
            at_stop=a.to_stop, arrival=a.arrival, departure=b.departure, walk_minutes=round(walk, 1),
            margin_minutes=round(margin, 1), expected_incoming_delay_minutes=round(means[i], 1),
            probability_missed=round(min(1.0, p_miss), 3),
            level="good" if p_miss < 0.15 else "fair" if p_miss < 0.35 else "low",
        ))

    p_all_changes = math.prod(1 - t.probability_missed for t in transfers)
    last_mean = means[rides[-1][0]]
    p_late5 = 1 - p_all_changes * (1 - math.exp(-5 / last_mean))
    arrival = legs[-1].arrival
    on_time = None
    if deadline is not None:
        deadline = deadline if deadline.tzinfo else deadline.replace(tzinfo=TZ)
        slack = _minutes(arrival, deadline)
        # + ON_TIME_TOLERANCE: arriving at 18:22:30 for an 18:22 deadline is still "on time"
        on_time = 0.0 if slack < 0 else p_all_changes * (1 - math.exp(-(slack + ON_TIME_TOLERANCE) / last_mean))
    level = _level(on_time if on_time is not None else 1 - p_late5)

    effective = arrival + timedelta(minutes=last_mean * math.log(5)
                                    + MISSED_CHANGE_PENALTY * sum(t.probability_missed for t in transfers))
    return TripReliability(
        level=level, label=LABELS[level], reason=_reason(leg_out, transfers, road_min, arrival, deadline),
        expected_delay_minutes=round(last_mean, 1), probability_late_5min=round(min(1.0, p_late5), 3),
        on_time_probability=round(on_time, 3) if on_time is not None else None,
        effective_arrival=effective.replace(microsecond=0),
        road_share=round(road_min / ride_min, 2) if ride_min else 0.0,
        legs=leg_out, transfers=transfers,
        source="tomtom_historic" if "tomtom_historic" in sources else "rush_hour_profile",
    )


def _reason(legs: list[LegReliability], transfers: list[TransferRisk], road_min: float,
            arrival: datetime, deadline: datetime | None) -> str:
    """One short sentence: the weakest link, in plain words."""
    if deadline is not None and arrival > deadline:
        return f"Arrives after {_hm(deadline)} even without delay"
    if deadline is not None and _minutes(arrival, deadline) < 3:
        return f"Arrives just before {_hm(deadline)}: no room for a delay"
    worst_t = max(transfers, key=lambda t: t.probability_missed, default=None)
    worst_l = max(legs, key=lambda x: x.expected_delay_minutes * x.road_exposure, default=None)
    if worst_t and worst_t.probability_missed >= 0.15:
        return f"Tight change at {worst_t.at_stop.name} ({max(0, round(worst_t.margin_minutes))} min)"
    if worst_l and worst_l.road_exposure > 0 and worst_l.typical_congestion_minutes >= 3:
        return worst_l.reason
    if road_min == 0:
        return "Rail only, no road traffic"
    return "Little traffic expected at this time"


def rank(items: list, reliabilities: list[TripReliability], deadline: datetime | None) -> list[int]:
    """Indices of `items` from safest to least safe.

    With a deadline: highest chance to make it (ties: earlier arrival). Without:
    earliest *effective* arrival, so a longer trip on rails beats a shorter one
    by bus when the bus usually loses more time than the difference."""
    idx = list(range(len(items)))
    if deadline is not None:
        return sorted(idx, key=lambda k: (-round(reliabilities[k].on_time_probability or 0, 2),
                                          reliabilities[k].effective_arrival))
    return sorted(idx, key=lambda k: reliabilities[k].effective_arrival)
