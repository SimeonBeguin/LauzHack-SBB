"""Estimate when a disrupted line reopens.

Rule: the official SBB end time stays the headline. The statistical range from
similar past incidents is shown around it and never contradicts it.

Method (chosen by back-testing on 2026, see evaluation.py):

1. Take the situation *now*: cause, interruption / restriction, how long it
   has lasted (elapsed), and the end time SBB currently announces.
2. Similar past incidents = past incidents that were **still ongoing at the
   same elapsed time** (survival logic: "it has lasted 1 h 30, what is left?").
   For each one we look at the version that was published at that same age.
3. Weights: same cause 1, same cause group 0.35, other 0.08; x0.6 if the kind
   (interruption / restriction) differs. Soft weights instead of hard filters
   keep enough cases for rare causes.
4. If SBB announces an end time ("official_corrected"):
       predicted end = official end + (real end - announced end) of similar cases
   otherwise ("survival"):
       predicted end = now + remaining duration of similar cases.
   Predictions are clipped to "not before now" (the incident is still open).
5. Weighted quantiles give the range; the CDF gives "P(over by 18:00)" and the
   commuter risk "P(still disrupted when my 7:32 leaves)".

Back-test 2026 (trained on incidents that ended before 2026): mean pinball
loss 38 min vs 46 min for the official time alone; the quantiles are
calibrated (the real end is before our median in 56 % of cases, before our
75th percentile in 81 %). See `python -m app.estimation.evaluation`.

Every function takes an `at` time, so a past incident can be replayed version
by version without looking at the future: only incidents that had already
ended before `at` are used as history.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta
from functools import lru_cache

import numpy as np
import pandas as pd

from app.estimation import features
from app.models import DepartureRisk, EndProbability, ReopeningEstimate

TZ = features.loaders.TZ

W_SAME_CAUSE = 1.0
W_SAME_GROUP = 0.35
W_OTHER = 0.08
W_OTHER_KIND = 0.6
ELAPSED_BUCKET_MIN = 5
LIKELY_Q = (0.25, 0.75)
WIDE_Q = (0.10, 0.90)


# ---------------------------------------------------------------------------
# Situation of an incident at a given moment
# ---------------------------------------------------------------------------

@dataclass
class IncidentState:
    """What a traveller can know about an incident at time `at`."""

    incident_id: str | None
    at: pd.Timestamp
    start: pd.Timestamp
    reason_id: str | None
    kind: str = "interruption"
    official_end: pd.Timestamp | None = None
    duration_type: str | None = None
    version_time: pd.Timestamp | None = None
    ended: bool = False
    real_end: pd.Timestamp | None = None  # only set when ended at `at`

    @property
    def elapsed_min(self) -> float:
        return max((self.at - self.start).total_seconds() / 60, 0.0)

    @property
    def reason_group(self) -> str:
        return features.reason_group(self.reason_id)


def _ts(x: datetime | pd.Timestamp | str | None) -> pd.Timestamp | None:
    if x is None or (isinstance(x, float) and np.isnan(x)):
        return None
    t = pd.Timestamp(x)
    if pd.isna(t):
        return None
    return t.tz_localize(TZ) if t.tzinfo is None else t.tz_convert(TZ)


def incident_state(incident_id: str, at: datetime | pd.Timestamp | None = None) -> IncidentState:
    """State of a known (past) incident at `at` (default: 45 min after its start).

    Raises KeyError if the incident is unknown.
    """
    history = _history_indexed()
    if incident_id not in history.index:
        raise KeyError(incident_id)
    h = history.loc[incident_id]
    at = _ts(at) or h["start"] + pd.Timedelta(minutes=45)
    snaps = _snapshots_by_incident().get(incident_id)

    if pd.notna(h["real_end"]) and at >= h["real_end"]:
        return IncidentState(
            incident_id, at, h["start"], h["reason_id"], h["kind"],
            ended=True, real_end=h["real_end"], version_time=h["real_end"],
        )
    if snaps is None or snaps.empty:
        return IncidentState(incident_id, at, h["start"], h["reason_id"], h["kind"])
    known = snaps[snaps["t"] <= at]
    # Before the first public version we still use it (VIA knows it already).
    v = known.iloc[-1] if len(known) else snaps.iloc[0]
    return IncidentState(
        incident_id=incident_id,
        at=at,
        start=h["start"],
        reason_id=v["reason_id"],
        kind=v["kind"] if v["kind"] in ("interruption", "restriction") else h["kind"],
        official_end=_ts(v["announced_end"]),
        duration_type=v["duration_type"],
        version_time=v["t"],
    )


@lru_cache(maxsize=1)
def _history_indexed() -> pd.DataFrame:
    return features.build_incident_history().set_index("incident_id", drop=False)


@lru_cache(maxsize=1)
def _snapshots_by_incident() -> dict[str, pd.DataFrame]:
    s = features.build_snapshots()
    return {i: g.reset_index(drop=True) for i, g in s.groupby("incident_id")}


# ---------------------------------------------------------------------------
# Similar incidents at the same age
# ---------------------------------------------------------------------------

@lru_cache(maxsize=4096)
def _candidates(elapsed_bucket: int, known_before: pd.Timestamp | None) -> pd.DataFrame:
    """Past usable incidents still ongoing after `elapsed_bucket` minutes,
    with the version that was in force at that age."""
    h = features.build_incident_history()
    h = h[h["usable"]]
    if known_before is not None:
        h = h[h["real_end"] < known_before]
    e = float(elapsed_bucket)
    alive = h[h["real_duration_min"] > e]
    s = features.build_snapshots()
    s = s[s["incident_id"].isin(alive["incident_id"])]
    in_force = s[s["elapsed_min"] <= e].groupby("incident_id").tail(1)
    first = s.groupby("incident_id").head(1)
    snap = pd.concat([in_force, first[~first["incident_id"].isin(in_force["incident_id"])]])
    c = alive.merge(
        snap[["incident_id", "kind", "announced_end", "reason_id"]].rename(
            columns={"kind": "snap_kind", "reason_id": "snap_reason"}
        ),
        on="incident_id", how="left",
    )
    age = c["start"] + pd.Timedelta(minutes=e)
    c["remaining_min"] = c["real_duration_min"] - e
    c["announced_remaining_min"] = (c["announced_end"] - age).dt.total_seconds() / 60
    c["announced_error_min"] = (c["real_end"] - c["announced_end"]).dt.total_seconds() / 60
    c["kind_at_age"] = c["snap_kind"].where(c["snap_kind"].isin(["interruption", "restriction"]), c["kind"])
    return c.reset_index(drop=True)


@dataclass
class EndDistribution:
    """Weighted sample of possible end times, as minutes after `at`."""

    at: pd.Timestamp
    remaining_min: np.ndarray
    weights: np.ndarray
    method: str
    n_same_cause: int
    n_same_group: int
    n_total: int

    def _sorted(self) -> tuple[np.ndarray, np.ndarray]:
        o = np.argsort(self.remaining_min)
        return self.remaining_min[o], self.weights[o]

    def quantile(self, q: float) -> pd.Timestamp:
        x, w = self._sorted()
        cum = (np.cumsum(w) - 0.5 * w) / w.sum()
        return self.at + pd.Timedelta(minutes=float(np.interp(q, cum, x)))

    def prob_ended_by(self, t: datetime | pd.Timestamp) -> float:
        minutes = (_ts(t) - self.at).total_seconds() / 60
        if minutes < 0:
            return 0.0
        return float(self.weights[self.remaining_min <= minutes].sum() / self.weights.sum())

    @property
    def similar_count(self) -> int:
        """Incidents that really drive the estimate (same cause, or same group if rare)."""
        return self.n_same_cause if self.n_same_cause >= 10 else self.n_same_group


def predict(state: IncidentState, known_before: pd.Timestamp | None = None) -> EndDistribution:
    """Distribution of the reopening time for an ongoing incident."""
    bucket = int(round(state.elapsed_min / ELAPSED_BUCKET_MIN) * ELAPSED_BUCKET_MIN)
    kb = known_before.floor("h") if known_before is not None else None
    c = _candidates(bucket, kb)
    if state.incident_id is not None:
        c = c[c["incident_id"] != state.incident_id]
    if len(c) < 5:  # very long incident: relax the survival condition
        c = _candidates(max(bucket // 2, 0), kb)
        c = c[c["incident_id"] != state.incident_id] if state.incident_id else c
    if len(c) < 5 and kb is not None:
        # Honest replay of one of the very first incidents (e.g. March 2024):
        # almost no history before it, so fall back to the whole history.
        return predict(state, None)

    same_cause = (c["reason_id"] == state.reason_id).to_numpy()
    same_group = (c["reason_group"] == state.reason_group).to_numpy()
    w = np.where(same_cause, W_SAME_CAUSE, np.where(same_group, W_SAME_GROUP, W_OTHER))
    w = w * np.where(c["kind_at_age"].to_numpy() == state.kind, 1.0, W_OTHER_KIND)

    if state.official_end is not None and c["announced_error_min"].notna().sum() >= 5:
        m = c["announced_error_min"].notna().to_numpy()
        announced_remaining = (state.official_end - state.at).total_seconds() / 60
        rem = announced_remaining + c["announced_error_min"].to_numpy()[m]
        w, same_cause, same_group = w[m], same_cause[m], same_group[m]
        method = "official_corrected"
    else:
        rem = c["remaining_min"].to_numpy()
        method = "survival"

    return EndDistribution(
        at=state.at,
        remaining_min=np.clip(rem, 0, None).astype(float),
        weights=w.astype(float),
        method=method,
        n_same_cause=int(same_cause.sum()),
        n_same_group=int(same_group.sum()),
        n_total=len(rem),
    )


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def _hm(t: pd.Timestamp) -> str:
    return t.tz_convert(TZ).strftime("%H:%M")


def _duration_txt(minutes: float) -> str:
    minutes = int(round(minutes))
    h, m = divmod(minutes, 60)
    return f"{h} h {m:02d}" if h else f"{m} min"


def _round5(t: pd.Timestamp, up: bool = True) -> pd.Timestamp:
    return t.ceil("5min") if up else t.floor("5min")


def _checkpoints(state: IncidentState, dist: EndDistribution) -> list[pd.Timestamp]:
    base = state.official_end if state.official_end is not None and state.official_end > state.at else None
    if base is not None:
        pts = [base, base + timedelta(minutes=30), base + timedelta(minutes=60), base + timedelta(minutes=120)]
    else:
        now5 = _round5(state.at)
        pts = [now5 + timedelta(minutes=m) for m in (30, 60, 120, 180)]
    return pts


def build_estimate(state: IncidentState, known_before: pd.Timestamp | None = None) -> ReopeningEstimate:
    """ReopeningEstimate for a state (works for live incidents too)."""
    if state.ended:
        end = state.real_end or state.at
        return ReopeningEstimate(
            official_end=end, likely_end_earliest=end, likely_end_latest=end, median_end=end,
            confidence=1.0, ended=True, as_of=state.at, method="ended",
            elapsed_minutes=int((end - state.start).total_seconds() // 60),
            explanation=f"Service resumed at {_hm(end)}.",
        )

    dist = predict(state, known_before)
    official = state.official_end
    q_lo, q_hi = (dist.quantile(q) for q in LIKELY_Q)
    w_lo, w_hi = (dist.quantile(q) for q in WIDE_Q)
    median = dist.quantile(0.5)

    # Never contradict SBB: the likely range contains the official time
    # (if it is still in the future), and nothing is before "now".
    lo, hi = q_lo, q_hi
    if official is not None and official > state.at:
        lo, hi = min(lo, official), max(hi, official)
        w_lo, w_hi = min(w_lo, official), max(w_hi, official)
    lo = _round5(max(lo, state.at), up=False)
    hi = _round5(max(hi, lo))
    confidence = dist.prob_ended_by(hi) - dist.prob_ended_by(lo - timedelta(seconds=1))

    probs = [EndProbability(time=t.to_pydatetime(), probability_ended=round(dist.prob_ended_by(t), 2))
             for t in _checkpoints(state, dist)]

    n = dist.similar_count
    scope = "same cause" if dist.n_same_cause >= 10 else "similar cause"
    age = f", still ongoing after {_duration_txt(state.elapsed_min)}" if state.elapsed_min >= 15 else ""
    if official is not None and official > state.at:
        p1, p2 = probs[0], probs[2]
        explanation = (
            f"SBB announces {_hm(official)}. In {n} past incidents ({scope}{age}), it was over by "
            f"{_hm(pd.Timestamp(p1.time))} in {p1.probability_ended:.0%} of cases and by "
            f"{_hm(pd.Timestamp(p2.time))} in {p2.probability_ended:.0%}."
        )
    elif official is not None:
        explanation = (
            f"The announced time ({_hm(official)}) has passed. In {n} past incidents ({scope}{age}), "
            f"half were over by {_hm(median)}."
        )
    else:
        p = probs[1]
        explanation = (
            f"No end time announced yet. In {n} past incidents ({scope}{age}), "
            f"it was over within an hour in {p.probability_ended:.0%} of cases."
        )

    return ReopeningEstimate(
        official_end=official.to_pydatetime() if official is not None else None,
        likely_end_earliest=lo.to_pydatetime(),
        likely_end_latest=hi.to_pydatetime(),
        confidence=round(float(np.clip(confidence, 0, 1)), 2),
        similar_incidents_count=n,
        explanation=explanation,
        ended=False,
        as_of=state.at.to_pydatetime(),
        elapsed_minutes=int(state.elapsed_min),
        median_end=_round5(max(median, state.at)).to_pydatetime(),
        wide_end_earliest=_round5(max(w_lo, state.at), up=False).to_pydatetime(),
        wide_end_latest=_round5(max(w_hi, state.at)).to_pydatetime(),
        probabilities=probs,
        method=dist.method,
    )


def _mock_estimate(official_end: datetime | None, reason: str) -> ReopeningEstimate:
    now = datetime.now().astimezone()
    official_end = official_end or now + timedelta(minutes=60)
    return ReopeningEstimate(
        official_end=official_end,
        likely_end_earliest=official_end - timedelta(minutes=10),
        likely_end_latest=official_end + timedelta(minutes=30),
        confidence=0.6,
        similar_incidents_count=0,
        explanation=f"MOCK: placeholder estimate ({reason})",
        method="mock",
    )


def estimate_reopening(
    incident_id: str,
    official_end: datetime | None = None,
    at: datetime | None = None,
    honest_replay: bool = True,
) -> ReopeningEstimate:
    """Estimate for a known incident at time `at` (default: 45 min after start).

    `official_end` overrides the end time announced in the data.
    With `honest_replay`, only incidents that ended before `at` are used, so a
    replay never looks into the future. Falls back to a mock estimate when the
    data folder is missing or the incident is unknown.
    """
    try:
        state = incident_state(incident_id, at)
    except FileNotFoundError:
        return _mock_estimate(official_end, "data folder not found")
    except KeyError:
        return _mock_estimate(official_end, f"unknown incident {incident_id}")
    if official_end is not None and not state.ended:
        state.official_end = _ts(official_end)
    return build_estimate(state, known_before=state.at if honest_replay else None)


def estimate_live(
    reason_id: str | None,
    start: datetime,
    official_end: datetime | None = None,
    kind: str = "interruption",
    at: datetime | None = None,
) -> ReopeningEstimate:
    """Estimate for a live incident that is not in the historical data
    (e.g. detected through OJP situations by the routing / notification parts)."""
    at_ts = _ts(at) or pd.Timestamp.now(tz=TZ)
    state = IncidentState(None, at_ts, _ts(start), reason_id, kind, official_end=_ts(official_end))
    return build_estimate(state)


def departure_risk(
    incident_id: str,
    departure: datetime,
    at: datetime | None = None,
    honest_replay: bool = True,
) -> DepartureRisk:
    """P(the line is still disrupted when the commuter's train leaves).

    Example: the 7:02 is stuck at Puidoux, my train leaves at 7:32 ->
    "65 % risk that the line is still closed for your 7:32".
    """
    state = incident_state(incident_id, at)
    dep = _ts(departure)
    if state.ended:
        return DepartureRisk(
            incident_id=incident_id, departure=dep.to_pydatetime(), as_of=state.at.to_pydatetime(),
            probability_still_disrupted=0.0, explanation="Service has already resumed.",
        )
    if dep <= state.at:
        p, n = 1.0, 0
    else:
        dist = predict(state, known_before=state.at if honest_replay else None)
        p, n = 1 - dist.prob_ended_by(dep), dist.similar_count
    official = f" SBB announces {_hm(state.official_end)}." if state.official_end is not None else ""
    return DepartureRisk(
        incident_id=incident_id,
        departure=dep.to_pydatetime(),
        as_of=state.at.to_pydatetime(),
        probability_still_disrupted=round(float(p), 2),
        similar_incidents_count=n,
        explanation=(
            f"{p:.0%} risk that the line is still disrupted at {_hm(dep)}.{official}"
            + (f" Based on {n} similar past incidents." if n else "")
        ),
    )


def replay_times(incident_id: str) -> list[pd.Timestamp]:
    """Moments worth replaying: every published version, then the end."""
    snaps = _snapshots_by_incident().get(incident_id)
    h = _history_indexed().loc[incident_id]
    times = [] if snaps is None else list(snaps["t"])
    if pd.notna(h["real_end"]):
        times.append(h["real_end"])
    return times


def clear_cache() -> None:
    for fn in (_history_indexed, _snapshots_by_incident, _candidates):
        fn.cache_clear()
