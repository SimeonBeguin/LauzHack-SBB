"""Tests of the Data & estimation workstream. Skipped when Daten/ is not present."""

import pandas as pd
import pytest

from app.config import settings

pytestmark = pytest.mark.skipif(
    not (settings.data_dir / "extern-liveticker").exists(), reason="Daten/ folder not available"
)

TZ = "Europe/Zurich"
DEMO = "2195005195853"  # fire Puidoux - Vauderens, 25.09.2026


def ts(s: str) -> pd.Timestamp:
    return pd.Timestamp(s, tz=TZ)


def test_loaders_types():
    from app.estimation import loaders

    inc = loaders.load_incidents()
    assert len(inc) == 523
    assert str(inc["created_at_source"].dt.tz) == TZ
    v = loaders.load_incident_versions()
    assert v["id"].nunique() == 550
    via = loaders.load_via_reports()
    assert via["alea_fall_id"].isin(inc["id"]).any()


def test_history_matches_known_figures():
    from app.estimation import features

    h = features.build_incident_history()
    u = h[h["usable"]]
    assert 480 <= len(u) <= 520
    # docs/PROJECT_CONTEXT.md: median real duration ~2 h 45
    assert 150 <= u["real_duration_min"].median() <= 180
    # first announcement too optimistic in ~68 % of cases
    assert 0.6 <= (u["first_announced_error_min"] > 0).mean() <= 0.75


def test_estimate_contains_official_time_and_never_before_now():
    from app.estimation import estimator

    at = ts("2026-09-25 16:30")
    e = estimator.estimate_reopening(DEMO, at=at)
    assert e.method == "official_corrected"
    assert e.likely_end_earliest <= e.official_end <= e.likely_end_latest
    assert e.likely_end_earliest >= at.floor("5min")
    probs = [p.probability_ended for p in e.probabilities]
    assert probs == sorted(probs)


def test_replay_has_no_look_ahead():
    from app.estimation import estimator

    at = ts("2026-09-25 16:30")
    state = estimator.incident_state(DEMO, at)
    dist = estimator.predict(state, known_before=at)
    cands = estimator._candidates(round(state.elapsed_min / 5) * 5, at.floor("h"))
    assert (cands["real_end"] < at).all()
    assert dist.n_total > 0


def test_estimate_after_end_is_ended():
    from app.estimation import estimator

    e = estimator.estimate_reopening(DEMO, at=ts("2026-09-25 19:00"))
    assert e.ended and e.method == "ended"


def test_departure_risk_decreases_with_later_departure():
    from app.estimation import estimator

    at = ts("2026-09-25 17:00")
    early = estimator.departure_risk(DEMO, ts("2026-09-25 17:30"), at=at)
    late = estimator.departure_risk(DEMO, ts("2026-09-25 20:00"), at=at)
    assert early.probability_still_disrupted >= late.probability_still_disrupted


def test_survival_without_announcement():
    from app.estimation import estimator

    now = pd.Timestamp.now(tz=TZ)
    e = estimator.estimate_live("EG_047", now - pd.Timedelta(minutes=30))
    assert e.method == "survival" and e.likely_end_latest >= e.likely_end_earliest


def test_timeline_replay():
    from app.estimation import replay

    tl = replay.timeline(DEMO)
    assert tl.points[0].what_changed == "First publication."
    assert tl.points[-1].kind == "resumed" and tl.points[-1].estimate.ended
    assert any("18:00 to 18:45" in p.what_changed for p in tl.points)


def test_kult_match_and_details():
    from app.estimation import kult

    d = kult.incident_details(DEMO)
    assert d.found and d.kult_case_id == "24666"
    assert any("Puidoux" in t for t in d.cancelled_or_diverted_trains)
    assert d.internal_messages
    early = kult.incident_details(DEMO, ts("2026-09-25 16:20"))
    assert len(early.internal_messages) < len(d.internal_messages)


def test_java_dump_parser_keeps_commas_and_quotes():
    from app.estimation.kult import parse_java_dump

    d = parse_java_dump(
        "InfoboardModule{id=1, ereignisfall=2, active='true', sender='TCC', titel='X', linie='', "
        "text='<span style='color:red'>a, b</span>', textVia='', timestamp=t, index=3, betriebspunkt=}"
    )
    assert d["text"] == "<span style='color:red'>a, b</span>" and d["index"] == "3"
