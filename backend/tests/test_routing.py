"""Routing tests. They run offline on the recorded OJP responses in
backend/data/ojp_recordings (OJP_MODE=replay), so no API key is needed."""

from datetime import datetime, timedelta

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.mock_data import get_journey
from app import situation
from app.models import Alternative, AlternativeCategory, Preferences, SituationAction, Stop
from app.routing.disruption import BlockedSection, parse_section_text, trip_uses_section
from app.routing.ojp_client import TZ, OJPCall, OJPClient, OJPLeg, OJPTrip, Recorder, didok, sloid
from app.routing.ranking import find_alternatives
from app.routing.ticket_validity import check_ticket


@pytest.fixture
def replay(monkeypatch):
    monkeypatch.setattr(settings, "ojp_mode", "replay")
    situation.apply("demo-zh", SituationAction(action="reset"))
    yield OJPClient(mode="replay")
    situation.apply("demo-zh", SituationAction(action="reset"))


def _t(hh, mm):
    return datetime(2026, 11, 23, hh, mm, tzinfo=TZ)


def _leg(line, stops, start, mode="train", pt_mode="rail"):
    calls = [OJPCall(sid, sid, arr_planned=_t(*start) + timedelta(minutes=5 * i),
                     dep_planned=_t(*start) + timedelta(minutes=5 * i)) for i, sid in enumerate(stops)]
    return OJPLeg("timed", mode, line, calls, calls[0].dep_planned, calls[-1].arr_planned, pt_mode=pt_mode)


SECTION = BlockedSection(Stop(id="8503125", name="Uster"), Stop(id="8503123", name="Wetzikon ZH"), ["8503124"])


def test_ids():
    assert didok("ch:1:sloid:3125:2:2") == "8503125"
    assert didok("ch:1:sloid:76105::57") == "8576105"
    assert sloid("8503125") == "ch:1:sloid:3125"


def test_section_blocking():
    s14 = OJPTrip("a", [_leg("S14", ["8503000", "8503125", "8503124", "8503123", "8503130"], (17, 42))])
    to_uster = OJPTrip("b", [_leg("S14", ["8503000", "8503125"], (17, 42))])
    s3 = OJPTrip("c", [_leg("S3", ["8503000", "8503006", "8503305", "8503301", "8503300", "8503123"], (18, 4))])
    assert trip_uses_section(s14, SECTION)
    assert not trip_uses_section(to_uster, SECTION)
    assert not trip_uses_section(s3, SECTION)


def test_parse_section_text():
    assert parse_section_text("Interruption Uster - Wetzikon ZH") == ("Uster", "Wetzikon ZH")
    assert parse_section_text("Palézieux - Romont") == ("Palézieux", "Romont")
    assert parse_section_text("Puidoux - Vauderens and Lucens") == ("Puidoux", "Vauderens")


def test_recorder_shifts_dates(tmp_path):
    rec = Recorder(tmp_path)
    req = "<DepArrTime>2026-11-23T16:42:00Z</DepArrTime>"
    rec.save(req, "<TimetabledTime>2026-11-23T17:00:00Z</TimetabledTime><OperatingDayRef>2026-11-23</OperatingDayRef>")
    out = rec.load(req.replace("2026-11-23", "2026-11-30"))
    assert "2026-11-30T17:00:00Z" in out and "<OperatingDayRef>2026-11-30" in out


def test_ticket_hint():
    dest = Stop(id="8503130", name="Hinwil")
    alt = Alternative(id="x", category=AlternativeCategory.NEARBY, arrival=_t(18, 40),
                      final_stop=Stop(id="8503122", name="Bubikon"), distance_to_destination_km=3.5)
    valid, hint = check_ticket(alt)
    assert valid is None and "Bubikon" in hint
    alt.final_stop, alt.distance_to_destination_km = dest, 0
    assert check_ticket(alt)[0] is True


def test_demo_zh_alternatives_avoid_blocked_section(replay):
    journey = get_journey("demo-zh")
    situation.apply("demo-zh", SituationAction(action="replacement_bus", value=True))
    res = find_alternatives(journey, Preferences(avoid_replacement_bus=False), replay)
    cats = res.by_category
    assert set(cats) == set(AlternativeCategory)
    assert cats[AlternativeCategory.FASTEST], "expected detours"
    for cat in (AlternativeCategory.FASTEST, AlternativeCategory.NEARBY, AlternativeCategory.COMFORT):
        for alt in cats[cat]:
            for leg in alt.legs:
                # no train between Uster and Wetzikon (the replacement bus is allowed)
                if leg.mode == "train":
                    assert {leg.from_stop.id, leg.to_stop.id} != {"8503125", "8503123"}
    lines = {leg.line for alt in cats[AlternativeCategory.FASTEST] for leg in alt.legs}
    assert "S3" in lines  # detour via Effretikon / Pfäffikon ZH
    assert "EV" in lines  # replacement bus Uster - Wetzikon
    assert any(a.distance_to_destination_km > 0.6 for a in cats[AlternativeCategory.NEARBY])
    assert cats[AlternativeCategory.WAIT]
    scores = [a.score for a in cats[AlternativeCategory.FASTEST]]
    assert scores == sorted(scores, reverse=True) and scores[0] == 100


def test_no_replacement_bus_unless_running(replay):
    journey = get_journey("demo-zh")
    res = find_alternatives(journey, Preferences(avoid_replacement_bus=False), replay)
    assert all(leg.mode != "replacement_bus" for alts in res.by_category.values() for a in alts for leg in a.legs)


def test_preferences_mark_replacement_bus_and_transfers(replay):
    journey = get_journey("demo-zh")
    situation.apply("demo-zh", SituationAction(action="replacement_bus", value=True))
    res = find_alternatives(journey, Preferences(avoid_replacement_bus=True, max_transfers=1), replay)
    fastest = res.by_category[AlternativeCategory.FASTEST]
    assert fastest and not fastest[0].disabled_reason
    bus = [a for a in fastest if any(leg.mode == "replacement_bus" for leg in a.legs)]
    assert bus, "the running replacement bus stays visible"
    assert all(a.disabled_reason for a in bus)
    assert all(a.transfers <= 1 or a.disabled_reason for a in fastest)


def test_resumed_line_gives_normal_trips(replay):
    journey = get_journey("demo-zh")
    situation.apply("demo-zh", SituationAction(action="resume"))
    res = find_alternatives(journey, Preferences(), replay)
    assert not res.by_category[AlternativeCategory.WAIT]
    lines = {leg.line for a in res.by_category[AlternativeCategory.FASTEST] for leg in a.legs}
    assert "S14" in lines


def test_endpoint_demo_zh(replay):
    r = TestClient(app).post("/alternatives", json={"journey_id": "demo-zh"})
    assert r.status_code == 200
    assert r.json()["by_category"]["fastest"]


def test_commuter_alert_from_situation(replay):
    from app.models import CommuterTrip
    from app.notifications import subscriptions, watcher

    watcher.reset()
    trip = subscriptions.add_trip(CommuterTrip(user_id="t", origin_stop_id="8503000",
                                               destination_stop_id="8503130", departure_time="18:12"))
    alerts = watcher.alerts_for("t")
    assert alerts and alerts[-1].notification.kind == "own_train"
    assert any(t.yours for t in alerts[-1].line) and alerts[-1].options
    situation.apply("demo-zh", SituationAction(action="resume"))
    assert watcher.alerts_for("t")[-1].notification.kind == "resolved"
    subscriptions.remove_trip(trip.id)
    watcher.reset()
