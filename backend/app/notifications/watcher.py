"""Match the live incidents against registered trips and create commuter alerts.

For each registered trip and each live situation (app/situation.py):

1. find the commuter's train on that day (OJP search at the usual departure);
2. if it runs through the blocked section, compute the chance the line is
   still closed when the train gets there (reopening curve of the estimate);
3. alert when that changes the message (or SBB announces a new end): ``line_disrupted``
   (the line is cut, mine should still get through), ``earlier_train`` (a train ahead is
   hit, mine may be), ``own_train`` (mine will probably not run), and
   ``resolved`` once the line reopens.

Alerts only start 3 h before the usual departure. Each alert carries the reasons,
the trains on the line and the best alternatives, computed at that moment.

Alerts are stored in memory per user and recomputed whenever the situation
or the trip changes (``alerts_for``, called by the API).
"""

from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta

from app import situation as situations
from app.models import (
    Alternative,
    AlternativeCategory,
    CommuterAlert,
    CommuterTrip,
    Journey,
    LineTrain,
    Notification,
    Preferences,
    ReopeningEstimate,
    Situation,
)
from app.routing.disruption import BlockedSection, section_entry_time, section_of, trip_uses_section
from app.routing.ojp_client import OJPClient, OJPError, OJPTrip
from app.routing.service_points import get_stop

log = logging.getLogger(__name__)

WATCH_BEFORE = timedelta(hours=3)  # start watching this long before the usual departure
WATCH_AFTER = timedelta(minutes=90)
P_OWN_TRAIN = 0.7  # chance the line is still closed: "your train will probably not run"
P_EARLIER = 0.2  # below this: "disruption on your line", your train should get through

_LOCK = threading.Lock()
_ALERTS: dict[str, list[CommuterAlert]] = {}  # user_id -> alerts, oldest first
_LAST_KIND: dict[tuple[str, str], tuple] = {}  # (trip id, incident id) -> (last kind, SBB end then)
_CHECKED: dict[tuple[str, str], tuple] = {}  # (trip id, incident id) -> (situation version, trip)


def _hm(t: datetime | None) -> str:
    return t.strftime("%H:%M") if t else "?"


def prob_closed_at(estimate: ReopeningEstimate, t: datetime) -> float:
    """Chance the line is still closed at `t`, interpolated on the estimate curve."""
    if estimate.ended:
        return 0.0
    now = estimate.as_of
    pts = ([(now, 0.0)] if now else []) + [(p.time, p.probability_ended) for p in estimate.probabilities]
    if not pts:
        return 1.0 if estimate.official_end and t < estimate.official_end else 0.5
    if t <= pts[0][0]:
        return 1.0 - pts[0][1]
    for (ta, pa), (tb, pb) in zip(pts, pts[1:]):
        if t <= tb:
            span = (tb - ta).total_seconds() or 1
            return 1.0 - (pa + (t - ta).total_seconds() / span * (pb - pa))
    return 1.0 - pts[-1][1]


def _usual_departure(trip: CommuterTrip, day: datetime) -> datetime:
    hh, mm = (int(x) for x in trip.departure_time.split(":"))
    return day.replace(hour=hh, minute=mm, second=0, microsecond=0)


def find_train(trip: CommuterTrip, when: datetime, client: OJPClient) -> OJPTrip | None:
    """The commuter's usual train on that day (first one at or after the usual time)."""
    trips = client.trip(trip.origin_stop_id, trip.destination_stop_id, when, num_results=3)
    later = [t for t in trips if t.departure_planned >= when - timedelta(minutes=1)]
    return min(later or trips, key=lambda t: abs((t.departure_planned - when).total_seconds()), default=None)


def _commuter_journey(trip: CommuterTrip, train: OJPTrip) -> Journey:
    origin = get_stop(trip.origin_stop_id)
    dest = get_stop(trip.destination_stop_id)
    line = next((leg.line for leg in train.pt_legs if leg.line), None) or "Train"
    return Journey(
        id=f"trip-{trip.id}", origin=origin or _stop(trip.origin_stop_id, trip.origin_name),
        destination=dest or _stop(trip.destination_stop_id, trip.destination_name),
        departure=train.departure_planned, arrival=train.arrival_planned, line=line,
    )


def _stop(stop_id: str, name: str | None):
    from app.models import Stop

    return Stop(id=stop_id, name=name or stop_id)


# ---------------------------------------------------------------------------
# One trip against one situation
# ---------------------------------------------------------------------------

def check_trip(trip: CommuterTrip, sit: Situation, client: OJPClient | None = None) -> CommuterAlert | None:
    """New alert for this trip if the situation changes what we tell the commuter."""
    client = client or OJPClient()
    if sit.clock.weekday() not in trip.weekdays:
        return None
    usual = _usual_departure(trip, sit.clock)
    if not (usual - WATCH_BEFORE <= sit.clock <= usual + WATCH_AFTER):
        return None
    section = section_of(sit, client)
    train = find_train(trip, usual, client)
    if section is None or train is None or not trip_uses_section(train, section):
        return None

    key = (trip.id or "", sit.incident_id)
    prev = _LAST_KIND.get(key)
    from app.api.disruptions import situation_estimate, status_from_situation
    from app.mock_data import get_journey

    status = status_from_situation(sit, get_journey(sit.journey_id))
    estimate = situation_estimate(sit)
    t_in = section_entry_time(train, section) or train.departure_planned
    if sit.resumed:
        kind, p = ("resolved", None) if prev and prev[0] in ("line_disrupted", "earlier_train", "own_train") \
            else (None, None)
    else:
        p = round(prob_closed_at(estimate, t_in), 2)
        kind = "own_train" if p >= P_OWN_TRAIN else "earlier_train" if p >= P_EARLIER else "line_disrupted"
    # New alert when the message changes, or when SBB announces a new end time
    if kind is None or (kind, sit.official_end) == prev:
        return None
    _LAST_KIND[key] = (kind, sit.official_end)

    journey = _commuter_journey(trip, train)
    options = [] if kind == "resolved" else _options(journey, sit, client)
    dep, dest = _hm(train.departure_planned), journey.destination.name
    advice = next((o for o in options if not o.uses_blocked_line), None)
    advice_txt = (f" Take the {_hm(advice.departure)} ({advice.title}), arriving {_hm(advice.arrival)}."
                  if advice else "")
    end = f"around {_hm(sit.official_end)}" if sit.official_end else "no end time announced yet"
    if kind == "resolved":
        title, headline = f"Line reopened: {sit.section}", "Trains are running again"
        body = f"Service resumed at {_hm(sit.resumed_at)}. Some trains may still be a few minutes late."
    elif kind == "own_train" and train.departure_planned <= sit.clock:
        title, headline = f"Your {dep} is held up before {sit.section}", "Your train cannot get through"
        body = f"No trains between {sit.section} ({end}).{advice_txt}"
    elif kind == "own_train":
        title, headline = f"Your {dep} will probably not run", "Your train will probably not run"
        body = f"No trains between {sit.section} ({end}).{advice_txt}"
    elif kind == "earlier_train":
        title, headline = f"Your {dep} to {dest} may be affected", "Your train may be affected"
        body = f"Trains are stopped between {sit.section} since {_hm(sit.start)}.{advice_txt}"
    else:
        title, headline = f"Disruption on your line: {sit.section}", "Your train should get through"
        body = (f"Trains are stopped between {sit.section} since {_hm(sit.start)} ({end}). "
                f"Your {dep} to {dest} should not be affected; we keep watching.")

    reasons = [f"No trains between {sit.section} since {_hm(sit.start)} ({status.reason or 'disruption'})."]
    if kind == "resolved":
        reasons = [f"Service resumed at {_hm(sit.resumed_at)}."]
    else:
        reasons.append(f"SBB: trains again {end}." if sit.official_end else "SBB has not announced an end time yet.")
        if sit.replacement_bus:
            reasons.append(f"Replacement buses run between {sit.section}.")
        if estimate.explanation:
            reasons.append(estimate.explanation)
        reasons.append(f"Your train reaches the closed section at {_hm(t_in)}: "
                       f"the line is still closed then in about {round(p * 10)} cases out of 10.")

    n_id = f"n{sum(len(v) for v in _ALERTS.values()) + 1}"
    return CommuterAlert(
        notification=Notification(
            id=n_id, trip_id=trip.id or "", title=title, body=body, incident_id=sit.incident_id,
            created_at=sit.clock, kind=kind, probability=p,
        ),
        trip=trip, planned_departure=train.departure_planned, planned_arrival=train.arrival_planned,
        headline=headline, reasons=reasons, line=_line_trains(trip, train, sit, section, estimate, client),
        options=options,
    )


def _options(journey: Journey, sit: Situation, client: OJPClient) -> list[Alternative]:
    """Best alternative that avoids the section, then waiting (from the routing)."""
    from app.routing.ranking import find_alternatives

    try:
        res = find_alternatives(journey, Preferences(), client, sit)
    except OJPError as exc:
        log.warning("No alternatives for commuter trip %s: %s", journey.id, exc)
        return []
    usable = [a for cat in (AlternativeCategory.FASTEST, AlternativeCategory.COMFORT)
              for a in res.by_category.get(cat, []) if not a.disabled_reason]
    best = min(usable, key=lambda a: a.arrival, default=None)
    wait = next(iter(res.by_category.get(AlternativeCategory.WAIT, [])), None)
    return [a for a in (best, wait) if a]


def _line_trains(trip: CommuterTrip, own: OJPTrip, sit: Situation, section: BlockedSection,
                 estimate: ReopeningEstimate, client: OJPClient) -> list[LineTrain]:
    """Trains on the commuter's route around their own: which are hit, which may be."""
    try:
        trips = client.trip(trip.origin_stop_id, trip.destination_stop_id,
                            own.departure_planned - timedelta(minutes=45), num_results=5)
    except OJPError:
        trips = [own]
    out: dict[datetime, LineTrain] = {}
    for t in trips:
        if t.departure_planned in out or not trip_uses_section(t, section):
            continue
        t_in = section_entry_time(t, section) or t.departure_planned
        line = next((leg.line for leg in t.pt_legs if leg.line), None)
        yours = t.signature() == own.signature()
        if sit.resumed:
            state, note = "ok", "Running"
        elif sit.start <= t_in <= sit.clock:
            state, note = "cancelled", f"Could not pass {sit.section}"
        else:
            p = prob_closed_at(estimate, t_in)
            if p >= P_OWN_TRAIN:
                state, note = "cancelled", "Probably cancelled or very late"
            elif p >= P_EARLIER:
                state, note = "at_risk", f"Affected if the line is still closed at {_hm(t_in)}"
            else:
                state, note = "ok", "Should run"
        out[t.departure_planned] = LineTrain(departure=t.departure_planned, line=line, state=state,
                                             note=note, yours=yours)
    return [out[k] for k in sorted(out)]


# ---------------------------------------------------------------------------
# All trips of a user
# ---------------------------------------------------------------------------

def alerts_for(user_id: str) -> list[CommuterAlert]:
    """Alerts of the user, after checking their trips against the current situations."""
    from app.notifications import subscriptions

    with _LOCK:
        version = situations.version()
        for trip in subscriptions.list_trips(user_id):
            for sit in situations.all_situations():
                key = (trip.id or "", sit.incident_id)
                stamp = (version, trip.model_dump_json())
                if _CHECKED.get(key) == stamp:
                    continue
                _CHECKED[key] = stamp
                try:
                    alert = check_trip(trip, sit)
                except OJPError as exc:
                    log.warning("Cannot check trip %s: %s", trip.id, exc)
                    continue
                if alert:
                    _ALERTS.setdefault(user_id, []).append(alert)
        return list(_ALERTS.get(user_id, []))


def reset() -> None:
    """Forget all alerts (the presenter resets the demo)."""
    with _LOCK:
        _ALERTS.clear()
        _LAST_KIND.clear()
        _CHECKED.clear()
