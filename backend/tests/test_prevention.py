"""Prevention (ideas 2, 3, 4) on hand-made trips: no network, TomTom faked."""

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from fastapi.testclient import TestClient

from app.main import app
from app.models import BookedTrip
from app.prevention import bookings, bus_delay, reliability
from app.routing.ojp_client import OJPCall, OJPLeg, OJPTrip, to_model_leg
from app.routing.road_traffic import RoadTime

TZ = ZoneInfo("Europe/Zurich")
T0 = datetime(2026, 11, 24, 17, 20, tzinfo=TZ)  # a Tuesday, evening rush hour


def m(x: float) -> datetime:
    return T0 + timedelta(minutes=x)


def bus_leg(start=0, stops=5, every=6, line="912", delay_now=0) -> OJPLeg:
    calls = []
    for k in range(stops):
        t = m(start + k * every)
        est = t + timedelta(minutes=delay_now) if delay_now else None
        calls.append(OJPCall(f"S{k}", f"Stop {k}", arr_planned=t if k else None, dep_planned=t if k < stops - 1 else None,
                             arr_estimated=est if k else None, dep_estimated=est if k < stops - 1 else None))
    return OJPLeg(kind="timed", mode="bus", line=line, calls=calls,
                  departure_planned=calls[0].dep_planned, arrival_planned=calls[-1].arr_planned)


def train_leg(dep, arr, frm="S4", to="Z", line="IR 15") -> OJPLeg:
    return OJPLeg(kind="timed", mode="train", line=line,
                  calls=[OJPCall(frm, frm, dep_planned=m(dep)), OJPCall(to, to, arr_planned=m(arr))],
                  departure_planned=m(dep), arrival_planned=m(arr))


def walk_leg(at, minutes) -> OJPLeg:
    return OJPLeg(kind="transfer", mode="walk", line=None,
                  calls=[OJPCall("S4", "Stop 4"), OJPCall("S4", "Stop 4")],
                  departure_planned=m(at), arrival_planned=m(at + minutes))


def fake_road(jam_on: str | None = "S2", live=12.0, typical=5.0):
    def road_time(a, b, depart_at=None, travel_mode="bus"):
        if a.id == jam_on:
            return RoadTime(live, 4.0, 3.0, minutes_historic=typical)
        return RoadTime(5.0, 4.0, 3.0, minutes_historic=5.0)
    return road_time


# --- idea 4: bus delay from live traffic -----------------------------------

def test_horizon_weight():
    assert bus_delay.horizon_weight(5) == 1 and bus_delay.horizon_weight(60) == 0
    assert 0 < bus_delay.horizon_weight(40) < 1


def test_jam_ahead_gives_a_delay_not_shown_yet(monkeypatch):
    monkeypatch.setattr(bus_delay, "road_time", fake_road())
    f = bus_delay.forecast_leg(bus_leg(), now=m(-5))
    assert f.source == "tomtom_live" and f.official_delay_minutes == 0
    assert f.predicted_delay_minutes == 7 and f.extra_minutes == 7  # 12 live - 5 typical
    assert any(s.jam for s in f.segments) and "Stop 2" in f.explanation


def test_jam_far_ahead_counts_less(monkeypatch):
    monkeypatch.setattr(bus_delay, "road_time", fake_road(jam_on="S3"))
    near = bus_delay.forecast_leg(bus_leg(), now=m(-5)).extra_minutes
    far = bus_delay.forecast_leg(bus_leg(start=30), now=m(-5)).extra_minutes  # reached ~50 min from now
    assert near >= 6 and far < near


def test_current_delay_is_kept(monkeypatch):
    monkeypatch.setattr(bus_delay, "road_time", fake_road(jam_on=None))
    f = bus_delay.forecast_leg(bus_leg(delay_now=3), now=m(1))
    assert f.official_delay_minutes == 3 and f.predicted_delay_minutes == 3 and f.extra_minutes == 0


def test_no_key_and_too_early(monkeypatch):
    monkeypatch.setattr(bus_delay, "road_time", lambda *a, **k: None)
    assert bus_delay.forecast_leg(bus_leg(), now=m(-5)).source == "unavailable"
    assert bus_delay.forecast_leg(bus_leg(), now=m(-120)).source == "too_early"
    sim = bus_delay.forecast_leg(bus_leg(), now=m(-5), simulate_jam_minutes=8)
    assert sim.source == "simulated" and sim.extra_minutes == 8


# --- idea 3: reliability gauge ----------------------------------------------

def test_rush_hour_profile():
    assert reliability.rush_hour_ratio(T0) > reliability.rush_hour_ratio(T0.replace(hour=14)) > 1
    assert reliability.rush_hour_ratio(T0 + timedelta(days=5)) == 1.0  # Sunday


def test_longer_train_beats_shorter_bus_at_rush_hour():
    by_bus = [to_model_leg(bus_leg(stops=6))]              # 30 min by bus
    by_train = [to_model_leg(train_leg(0, 35, frm="S0"))]  # 35 min by train
    rb = reliability.assess(by_bus, now=m(-60), use_tomtom=False)
    rt = reliability.assess(by_train, now=m(-60), use_tomtom=False)
    assert rb.level != "good" and rt.level == "good" and rt.road_share == 0
    assert "traffic" in rb.reason
    assert reliability.rank(["bus", "train"], [rb, rt], None) == [1, 0]
    # with a deadline both make: the train is the safer bet
    deadline = m(45)
    rb = reliability.assess(by_bus, deadline=deadline, now=m(-60), use_tomtom=False)
    rt = reliability.assess(by_train, deadline=deadline, now=m(-60), use_tomtom=False)
    assert rt.on_time_probability > rb.on_time_probability
    assert reliability.rank(["bus", "train"], [rb, rt], deadline) == [1, 0]


def test_tight_change_after_a_bus_is_flagged():
    legs = [to_model_leg(x) for x in (bus_leg(), walk_leg(24, 2), train_leg(27, 60))]
    r = reliability.assess(legs, now=m(-60), use_tomtom=False)
    assert r.transfers and r.transfers[0].margin_minutes == 1 and r.transfers[0].level == "low"
    assert "Tight change" in r.reason


# --- idea 2: booked trips ---------------------------------------------------

class FakeClient:
    def __init__(self, trip):
        self._trip = trip

    def trip(self, *a, **k):
        return [self._trip]


def test_booking_alert_when_traffic_breaks_the_change(monkeypatch):
    trip = OJPTrip("t1", [bus_leg(), walk_leg(24, 2), train_leg(32, 60)])  # 6 min margin
    client = FakeClient(trip)
    monkeypatch.setattr(bookings, "_disruption", lambda *a: None)
    monkeypatch.setattr(bus_delay, "road_time", lambda *a, **k: None)
    monkeypatch.setattr(reliability, "road_time", lambda *a, **k: None)
    bookings.clear()
    b = bookings.book(BookedTrip(user_id="u-prev", origin_stop_id="S0", destination_stop_id="Z", departure=m(0)),
                      client)
    assert b.legs and b.arrival == m(60)

    status, _, _ = bookings.check(b, now=m(-5), client=client)
    assert status.state in ("ok", "at_risk")
    assert bookings.alerts_for("u-prev", now=m(-5), client=client) == [] or status.state == "at_risk"

    jam = bookings.alerts_for("u-prev", now=m(-5), client=client, simulate_jam_minutes=10)
    last = jam[-1]
    assert last.notification.kind == "connection_broken" and last.connections[0].status == "broken"
    assert "traffic" in last.reasons[0] and last.ticket_note
    # same situation again: no duplicate
    assert len(bookings.alerts_for("u-prev", now=m(-5), client=client, simulate_jam_minutes=10)) == len(jam)
    back = bookings.alerts_for("u-prev", now=m(-5), client=client)
    assert back[-1].notification.kind in ("booking_back_to_normal", "connection_at_risk")
    bookings.remove(b.id)


def test_booking_not_watched_too_early():
    trip = OJPTrip("t1", [train_leg(0, 30, frm="S0")])
    b = BookedTrip(user_id="u", origin_stop_id="S0", destination_stop_id="Z", departure=m(0), arrival=m(30))
    status, _, _ = bookings.check(b, now=m(-60 * 30), client=FakeClient(trip))
    assert status.state == "not_watched"


def test_routes_are_registered():
    paths = set(app.openapi()["paths"])
    assert {"/prevention/plan", "/prevention/bus-delay", "/prevention/bookings",
            "/prevention/{user_id}/booking-alerts"} <= paths
    assert TestClient(app).get("/prevention/bookings", params={"user_id": "nobody"}).json() == []
