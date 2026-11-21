"""Idea 2: watch trips paid in advance and warn before a connection is lost.

A traveller registers a booked trip (e.g. a Supersaver ticket, bound to its
trains). From 24 h before departure until arrival, each check:

1. finds the booked connection again in OJP (real-time times, cancellations);
2. checks it against the live incidents (app/situation.py): does it run through
   a blocked section, and is the line still closed when it gets there?
3. forecasts every bus leg with the live traffic ahead (idea 4, bus_delay.py);
4. checks every change: incoming arrival (real-time + our bus forecast) vs
   outgoing departure, minus the walk; chance to miss it from the usual delay
   of the incoming leg (idea 3, reliability.py).

A new alert is created when the state gets worse (or back to normal), with
the reasons and other ways to get there. In memory, like the commuter alerts;
the app polls ``GET /prevention/{user_id}/booking-alerts``.
"""

from __future__ import annotations

import logging
import math
import threading
import uuid
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from app import situation as situations
from app.models import (
    Alternative,
    AlternativeCategory,
    BookedTrip,
    BookingAlert,
    BookingStatus,
    BusDelayForecast,
    ConnectionCheck,
    Journey,
    Notification,
    Stop,
)
from app.prevention import bus_delay, reliability
from app.routing.ojp_client import OJPClient, OJPError, OJPTrip, to_model_leg

log = logging.getLogger(__name__)

TZ = ZoneInfo("Europe/Zurich")
WATCH_BEFORE = timedelta(hours=24)
P_AT_RISK = 0.3        # chance to miss a change: "at risk"
P_DISRUPTED = 0.2      # chance the blocked line is still closed when the train gets there
FORECAST_RESIDUAL_DELAY = 1.0  # min: uncertainty left once a bus leg has a live forecast

_LOCK = threading.Lock()
_BOOKINGS: dict[str, BookedTrip] = {}
_ALERTS: dict[str, list[BookingAlert]] = {}   # user_id -> alerts, oldest first
_LAST: dict[str, tuple] = {}                  # booking id -> (state, key) of the last alert


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

def book(booking: BookedTrip, client: OJPClient | None = None) -> BookedTrip:
    """Register a booked trip; the connection that was bought is looked up in OJP."""
    client = client or OJPClient()
    booking.id = booking.id or uuid.uuid4().hex[:8]
    trip = find_connection(booking, client)
    if trip is not None:
        booking.legs = [to_model_leg(leg) for leg in trip.legs]
        booking.arrival = trip.arrival_planned
        booking.departure = trip.departure_planned
        booking.origin_name = booking.origin_name or trip.legs[0].board.name
        booking.destination_name = booking.destination_name or trip.legs[-1].alight.name
    with _LOCK:
        _BOOKINGS[booking.id] = booking
    return booking


def list_bookings(user_id: str | None = None) -> list[BookedTrip]:
    return [b for b in _BOOKINGS.values() if user_id is None or b.user_id == user_id]


def get_booking(booking_id: str) -> BookedTrip | None:
    return _BOOKINGS.get(booking_id)


def remove(booking_id: str) -> None:
    with _LOCK:
        _BOOKINGS.pop(booking_id, None)
        _LAST.pop(booking_id, None)


def reset_alerts() -> None:
    with _LOCK:
        _ALERTS.clear()
        _LAST.clear()


# ---------------------------------------------------------------------------
# Checking one booking
# ---------------------------------------------------------------------------

def _hm(t: datetime | None) -> str:
    return t.astimezone(TZ).strftime("%H:%M") if t else "?"


def _minutes(a: datetime, b: datetime) -> float:
    return (b - a).total_seconds() / 60


def find_connection(booking: BookedTrip, client: OJPClient) -> OJPTrip | None:
    """The booked connection (same first train and departure), with real-time data."""
    trips = client.trip(booking.origin_stop_id, booking.destination_stop_id,
                        booking.departure - timedelta(minutes=1), num_results=4)
    if not trips:
        return None
    if booking.legs:
        first = next((leg for leg in booking.legs if leg.mode not in ("walk", "wait")), None)
        for t in trips:
            pt = t.pt_legs[0] if t.pt_legs else None
            if first and pt and pt.line == first.line and pt.departure_planned == first.departure:
                return t
    return min(trips, key=lambda t: abs((t.departure_planned - booking.departure).total_seconds()))


def demo_now(booking: BookedTrip) -> datetime:
    """The demo clock when a demo situation runs on the booking's day, else the real time."""
    day = booking.departure.astimezone(TZ).date()
    clocks = [s.clock for s in situations.all_situations() if s.clock.astimezone(TZ).date() == day]
    return max(clocks) if clocks else datetime.now(TZ)


def _disruption(trip: OJPTrip, client: OJPClient) -> tuple[str, object] | None:
    """(reason, situation) if the trip runs through a blocked section that is still closed then."""
    from app.api.disruptions import situation_estimate
    from app.notifications.watcher import prob_closed_at
    from app.routing.disruption import section_entry_time, section_of, trip_uses_section

    for sit in situations.all_situations():
        if sit.resumed:
            continue
        try:
            section = section_of(sit, client)
        except OJPError:
            continue
        if section is None or not trip_uses_section(trip, section):
            continue
        t_in = section_entry_time(trip, section) or trip.departure_planned
        p = prob_closed_at(situation_estimate(sit), t_in)
        if p >= P_DISRUPTED:
            end = f"SBB expects trains again around {_hm(sit.official_end)}" if sit.official_end \
                else "SBB has not announced an end time yet"
            return (f"No trains between {sit.section} since {_hm(sit.start)}; your train gets there at "
                    f"{_hm(t_in)} ({end}). Still closed then in about {round(p * 10)} cases out of 10."), sit
    return None


def check(booking: BookedTrip, now: datetime | None = None, client: OJPClient | None = None,
          simulate_jam_minutes: float | None = None) -> tuple[BookingStatus, OJPTrip | None, object]:
    """Current state of the booking. Returns (status, OJP trip, blocking situation or None)."""
    client = client or OJPClient()
    now = now or demo_now(booking)
    arrival = booking.arrival or booking.departure + timedelta(hours=3)
    status = BookingStatus(booking=booking, as_of=now, state="ok", summary="Your connections look fine.")
    if not (booking.departure - WATCH_BEFORE <= now <= arrival):
        status.state = "not_watched"
        status.summary = ("We start checking 24 h before departure." if now < booking.departure
                          else "This trip is over.")
        return status, None, None

    trip = find_connection(booking, client)
    if trip is None:
        status.state, status.summary = "broken", "Your booked connection is no longer in the timetable."
        return status, None, None

    legs = [to_model_leg(leg) for leg in trip.legs]
    status.reliability = reliability.assess(legs, now=now)
    forecasts = bus_delay.forecast_trip(trip, now=now, simulate_jam_minutes=simulate_jam_minutes)
    status.bus_forecasts = forecasts
    status.connections = _connections(trip, forecasts, status.reliability, now)

    blocked = _disruption(trip, client)
    cancelled = next((leg for leg in trip.pt_legs if leg.cancelled), None)
    worst = max(status.connections, key=lambda c: c.probability_missed, default=None)
    if blocked:
        status.state, status.summary = "disrupted", blocked[0]
    elif cancelled:
        status.state = "broken"
        status.summary = f"Your {cancelled.line or 'train'} at {_hm(cancelled.departure_planned)} is cancelled."
    elif worst and worst.status == "broken":
        status.state = "broken"
        status.summary = f"You will probably miss your change at {worst.at_stop.name}. {worst.cause}".strip()
    elif worst and worst.status == "at_risk":
        status.state = "at_risk"
        status.summary = f"Your change at {worst.at_stop.name} is at risk. {worst.cause}".strip()
    return status, trip, blocked[1] if blocked else None


def _connections(trip: OJPTrip, forecasts: list[BusDelayForecast], rel, now: datetime) -> list[ConnectionCheck]:
    rides = [(i, leg) for i, leg in enumerate(trip.legs) if leg.is_public_transport]
    by_leg = {(f.from_stop.id, f.planned_departure): f for f in forecasts}
    mean_by_stop = {lr.from_stop.id: lr.expected_delay_minutes for lr in rel.legs}
    out = []
    for (i, a), (j, b) in zip(rides, rides[1:]):
        fc = by_leg.get((a.board.stop_id, a.departure_planned))
        extra = fc.extra_minutes if fc and fc.source in ("tomtom_live", "simulated") else 0
        arr = a.arrival + timedelta(minutes=extra)
        walk = sum(max(0.0, _minutes(x.departure, x.arrival)) for x in trip.legs[i + 1:j] if x.mode == "walk")
        margin = _minutes(arr, b.departure) - walk
        residual = FORECAST_RESIDUAL_DELAY if fc and extra else mean_by_stop.get(a.board.stop_id, 1.0)
        if arr <= now:
            residual = 0.3  # the incoming vehicle has arrived: its delay is known
        p = 1.0 if margin < 0 else math.exp(-(margin + reliability.OJP_BUFFER_MIN) / max(residual, 0.3))
        state = "broken" if margin < 0 else "at_risk" if p >= P_AT_RISK else "ok"
        name = f"{a.line or a.mode}"
        if extra:
            cause = f"{name} will probably arrive {fc.predicted_delay_minutes} min late (traffic ahead)."
        elif a.arrival_estimated and a.arrival_estimated > a.arrival_planned:
            cause = f"{name} is {round(_minutes(a.arrival_planned, a.arrival_estimated))} min late."
        elif state != "ok":
            cause = f"Only {max(0, round(margin))} min to change after {name}, which is often late at this time."
        else:
            cause = ""
        out.append(ConnectionCheck(
            at_stop=Stop(id=a.alight.stop_id, name=a.alight.name), arrival=arr, departure=b.departure,
            margin_minutes=round(margin, 1), probability_missed=round(min(1.0, p), 3), status=state, cause=cause,
        ))
    return out


# ---------------------------------------------------------------------------
# Alerts
# ---------------------------------------------------------------------------

KIND = {"disrupted": "booked_train_disrupted", "broken": "connection_broken", "at_risk": "connection_at_risk"}


def _ticket_note(booking: BookedTrip) -> str | None:
    if booking.ticket_kind == "supersaver":
        return ("Supersaver tickets are bound to the booked trains. When a delay makes you miss a connection, "
                "SBB normally lifts that restriction: check in the SBB app or ask staff before you change trains.")
    if booking.ticket_kind == "travelcard":
        return "Your travelcard is valid on these options."
    return "Your ticket is valid on other trains on the same route."


def _options(booking: BookedTrip, status: BookingStatus, sit, client: OJPClient) -> list[Alternative]:
    if status.state == "disrupted" and sit is not None:
        from app.notifications.watcher import _options as disruption_options

        journey = Journey(
            id=f"booking-{booking.id}",
            origin=Stop(id=booking.origin_stop_id, name=booking.origin_name or booking.origin_stop_id),
            destination=Stop(id=booking.destination_stop_id,
                             name=booking.destination_name or booking.destination_stop_id),
            departure=booking.departure, arrival=booking.arrival or booking.departure, line="",
        )
        return disruption_options(journey, sit, client)
    worst = max(status.connections, key=lambda c: c.probability_missed, default=None)
    if worst is None or worst.status == "ok":
        return []
    try:
        trips = client.trip(worst.at_stop.id, booking.destination_stop_id, worst.arrival + timedelta(minutes=2), 3)
    except OJPError:
        return []
    alts = []
    for k, t in enumerate(trips[:2], start=1):
        legs = [to_model_leg(leg) for leg in t.legs]
        rides = [leg for leg in legs if leg.mode not in ("walk", "wait")]
        alts.append(Alternative(
            id=f"booking-{booking.id}-{k}", category=AlternativeCategory.FASTEST, legs=legs, arrival=t.arrival,
            final_stop=legs[-1].to_stop, transfers=t.transfers, departure=rides[0].departure if rides else None,
            title=f"Next connection from {worst.at_stop.name}",
            subtitle=f"Leaves {_hm(rides[0].departure) if rides else '?'}, arrives {_hm(t.arrival)}",
            ticket_hint=_ticket_note(booking),
        ))
    return alts


def alerts_for(user_id: str, now: datetime | None = None, client: OJPClient | None = None,
               simulate_jam_minutes: float | None = None) -> list[BookingAlert]:
    """Alerts of the user, after checking their booked trips now."""
    client = client or OJPClient()
    with _LOCK:
        for booking in list_bookings(user_id):
            try:
                status, _, sit = check(booking, now, client, simulate_jam_minutes)
            except OJPError as exc:
                log.warning("Cannot check booking %s: %s", booking.id, exc)
                continue
            alert = _alert_if_new(booking, status, sit, client)
            if alert:
                _ALERTS.setdefault(user_id, []).append(alert)
        return list(_ALERTS.get(user_id, []))


def _alert_if_new(booking: BookedTrip, status: BookingStatus, sit, client: OJPClient) -> BookingAlert | None:
    if status.state == "not_watched":
        return None
    worst = max(status.connections, key=lambda c: c.probability_missed, default=None)
    key = (status.state, worst.at_stop.id if worst and worst.status != "ok" else None)
    prev = _LAST.get(booking.id or "")
    if prev == key:
        return None
    if status.state == "ok":
        if prev is None or prev[0] == "ok":
            _LAST[booking.id or ""] = key
            return None
        kind, title, headline = ("booking_back_to_normal", "Your booked trip is back to normal",
                                 "Your connections work again")
        body = "No change needed: travel as booked."
    else:
        kind = KIND[status.state]
        dep = _hm(booking.departure)
        title = {
            "disrupted": f"Your booked {dep} train is affected by a disruption",
            "broken": f"Your {dep} trip: you will probably miss a connection",
            "at_risk": f"Your {dep} trip: a connection is at risk",
        }[status.state]
        headline = {"disrupted": "Your train may not get through", "broken": "You will probably miss your change",
                    "at_risk": "Your change may be tight"}[status.state]
        body = status.summary
    _LAST[booking.id or ""] = key
    options = [] if status.state == "ok" else _options(booking, status, sit, client)
    if options and status.state != "ok":
        body += f" Option: {options[0].title}, arriving {_hm(options[0].arrival)}."
    reasons = [status.summary] + [c.cause for c in status.connections if c.cause and c.cause not in status.summary]
    reasons += [f.explanation for f in status.bus_forecasts if f.extra_minutes and f.explanation not in reasons]
    n_id = f"b{sum(len(v) for v in _ALERTS.values()) + 1}"
    worst_p = worst.probability_missed if worst else None
    return BookingAlert(
        notification=Notification(id=n_id, trip_id=booking.id or "", title=title, body=body,
                                  incident_id=getattr(sit, "incident_id", None), created_at=status.as_of,
                                  kind=kind, probability=worst_p),
        booking=booking, headline=headline, reasons=reasons, connections=status.connections,
        bus_forecasts=status.bus_forecasts, options=options, ticket_note=_ticket_note(booking),
    )
