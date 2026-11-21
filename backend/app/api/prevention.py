"""Prevention: warn before a delay happens. Owner: Prevention.

    POST   /prevention/plan                         idea 3: trips ranked by reliability (rush-hour traffic)
    GET    /prevention/bus-delay                    idea 4: future bus delay from live traffic (TomTom)
    POST   /prevention/bookings                     idea 2: register a trip paid in advance
    GET    /prevention/bookings?user_id=            list booked trips
    DELETE /prevention/bookings/{booking_id}
    GET    /prevention/bookings/{booking_id}/status current check (also when nothing is wrong)
    GET    /prevention/{user_id}/booking-alerts     alerts to show (the app polls it)

Demo: ``simulate_jam_minutes`` puts a jam of that many minutes on the bus
route (works without a TomTom key; results are marked "simulated").
Frontend notes: docs/prevention-frontend-handoff.md
"""

from datetime import datetime

from fastapi import APIRouter, HTTPException, Query

from app.models import (
    BookedTrip,
    BookingAlert,
    BookingStatus,
    BusDelayResponse,
    PlannedTrip,
    ReliablePlanRequest,
    ReliablePlanResponse,
)
from app.prevention import bookings, bus_delay, reliability
from app.routing.ojp_client import OJPClient, OJPError, to_model_leg

router = APIRouter(prefix="/prevention", tags=["prevention"])

JAM = Query(None, ge=0, le=60, description="Demo: add a traffic jam of this many minutes on each bus leg")


def _ojp_error(exc: OJPError) -> HTTPException:
    return HTTPException(503, f"Timetable (OJP) unavailable: {exc}")


@router.post("/plan", response_model=ReliablePlanResponse)
def reliable_plan(req: ReliablePlanRequest) -> ReliablePlanResponse:
    try:
        trips = OJPClient().trip(req.origin_stop_id, req.destination_stop_id, req.departure,
                                 num_results=req.num_results)
    except OJPError as exc:
        raise _ojp_error(exc)
    planned = []
    for k, t in enumerate(trips, start=1):
        legs = [to_model_leg(leg) for leg in t.legs]
        planned.append(PlannedTrip(
            id=f"plan-{k}", legs=legs, departure=t.departure, arrival=t.arrival, transfers=t.transfers,
            reliability=reliability.assess(legs, deadline=req.deadline, now=None),
        ))
    order = reliability.rank(planned, [p.reliability for p in planned], req.deadline)
    ranked = [planned[k] for k in order]
    if ranked:
        ranked[0].recommended = True
        fastest = min(ranked, key=lambda p: p.arrival)
        best = ranked[0]
        if best is not fastest:
            longer = round((best.arrival - fastest.arrival).total_seconds() / 60)
            best.note = (f"{longer} min later than the fastest, but more reliable: {best.reliability.reason.lower()}"
                         if longer > 0 else f"More reliable: {best.reliability.reason.lower()}")
            fastest.note = f"Fastest, but {fastest.reliability.label.lower()}: {fastest.reliability.reason.lower()}"
    ranking = ("Best chance to arrive by the time you chose" if req.deadline
               else "Earliest arrival once usual traffic delays are counted")
    return ReliablePlanResponse(trips=ranked, ranking=ranking)


@router.get("/bus-delay", response_model=BusDelayResponse)
def bus_delay_forecast(
    origin_stop_id: str, destination_stop_id: str, departure: datetime,
    simulate_jam_minutes: float | None = JAM,
) -> BusDelayResponse:
    """Forecasts for the bus legs of the first trip leaving at or after `departure`."""
    try:
        trips = OJPClient().trip(origin_stop_id, destination_stop_id, departure, num_results=3)
    except OJPError as exc:
        raise _ojp_error(exc)
    trip = next((t for t in trips if any(leg.mode in bus_delay.BUS_MODES for leg in t.pt_legs)), None) \
        or (trips[0] if trips else None)
    if trip is None:
        return BusDelayResponse()
    return BusDelayResponse(trip_departure=trip.departure, trip_arrival=trip.arrival,
                            forecasts=bus_delay.forecast_trip(trip, simulate_jam_minutes=simulate_jam_minutes))


@router.post("/bookings", response_model=BookedTrip)
def add_booking(booking: BookedTrip) -> BookedTrip:
    booking.legs, booking.arrival = [], None  # always from the timetable
    try:
        return bookings.book(booking)
    except OJPError as exc:
        raise _ojp_error(exc)


@router.get("/bookings", response_model=list[BookedTrip])
def list_bookings(user_id: str | None = None) -> list[BookedTrip]:
    return bookings.list_bookings(user_id)


@router.delete("/bookings/{booking_id}")
def delete_booking(booking_id: str) -> dict:
    bookings.remove(booking_id)
    return {"ok": True}


@router.get("/bookings/{booking_id}/status", response_model=BookingStatus)
def booking_status(booking_id: str, simulate_jam_minutes: float | None = JAM) -> BookingStatus:
    booking = bookings.get_booking(booking_id)
    if booking is None:
        raise HTTPException(404, f"No booking {booking_id}")
    try:
        return bookings.check(booking, simulate_jam_minutes=simulate_jam_minutes)[0]
    except OJPError as exc:
        raise _ojp_error(exc)


@router.get("/{user_id}/booking-alerts", response_model=list[BookingAlert])
def booking_alerts(user_id: str, simulate_jam_minutes: float | None = JAM) -> list[BookingAlert]:
    return bookings.alerts_for(user_id, simulate_jam_minutes=simulate_jam_minutes)
