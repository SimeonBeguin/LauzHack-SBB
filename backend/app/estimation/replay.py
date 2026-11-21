"""Replay a past incident as if it were live (for the demo and for commuter alerts).

- `status_at()`  : DisruptionStatus at any moment of the incident.
- `timeline()`   : every published version + the estimate we would have shown.
- `shift_to_now()`: move all timestamps so that the replayed moment is "now"
                   (the frontend and OJP then see a live-looking incident).
- `demo_incidents()`: good incidents to replay (with internal KULT details).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from functools import lru_cache

import pandas as pd
from pydantic import BaseModel

from app.estimation import estimator, features, loaders
from app.models import DisruptionStatus, IncidentTimeline, TimelinePoint

TZ = loaders.TZ
DEFAULT_REPLAY_MINUTES = 45  # default moment of a replay: 45 min after the start


@lru_cache(maxsize=1)
def _versions_by_incident() -> dict[str, pd.DataFrame]:
    v = features.incident_versions()
    return {i: g.sort_values("t").reset_index(drop=True) for i, g in v.groupby("id")}


@lru_cache(maxsize=1)
def _reason_labels() -> dict[str, str]:
    r = loaders.load_reasons()
    return dict(zip(r["id"], r["reason_en"]))


def resolve_time(incident_id: str, at: datetime | str | None = None,
                 minutes_since_start: float | None = None) -> pd.Timestamp:
    h = estimator._history_indexed().loc[incident_id]
    if at is not None:
        return estimator._ts(at)
    minutes = DEFAULT_REPLAY_MINUTES if minutes_since_start is None else minutes_since_start
    return h["start"] + pd.Timedelta(minutes=minutes)


def _version_at(incident_id: str, at: pd.Timestamp) -> pd.Series:
    v = _versions_by_incident()[incident_id]
    known = v[v["t"] <= at]
    return known.iloc[-1] if len(known) else v.iloc[0]


def status_at(incident_id: str, journey_id: str, at: pd.Timestamp) -> DisruptionStatus:
    h = estimator._history_indexed().loc[incident_id]
    v = _version_at(incident_id, at)
    estimate = estimator.estimate_reopening(incident_id, at=at)
    return DisruptionStatus(
        incident_id=incident_id,
        journey_id=journey_id,
        title=v["summary_en"],
        reason=_reason_labels().get(v["reason_id_fk"], v["reason_id_fk"]),
        affected_section=h["section"],
        estimate=estimate,
        last_update=min(v["t"], at).to_pydatetime(),
    )


def _what_changed(prev: pd.Series | None, cur: pd.Series, ended: bool) -> str:
    if ended:
        return "SBB reports that service has resumed."
    if prev is None:
        return "First publication."
    changes = []
    if cur["kind"] != prev["kind"]:
        changes.append(f"{prev['kind']} -> {cur['kind']}")
    a0, a1 = prev["announced_end"], cur["announced_end"]
    if pd.notna(a1) and (pd.isna(a0) or a0 != a1):
        changes.append(
            f"SBB moved the end from {a0:%H:%M} to {a1:%H:%M}" if pd.notna(a0) else f"SBB announces {a1:%H:%M}"
        )
    if cur["reason_id_fk"] != prev["reason_id_fk"]:
        changes.append(f"cause corrected to {_reason_labels().get(cur['reason_id_fk'], cur['reason_id_fk'])}")
    return "; ".join(changes) or "Text updated, same end time."


def timeline(incident_id: str) -> IncidentTimeline:
    h = estimator._history_indexed().loc[incident_id]
    v = _versions_by_incident()[incident_id]
    ongoing = v[v["lifecycle"] == "INFO"]
    if pd.notna(h["real_end"]):
        ongoing = ongoing[ongoing["t"] < h["real_end"]]
    ongoing = ongoing.drop_duplicates("t", keep="last")
    points: list[TimelinePoint] = []
    prev = None
    for _, cur in ongoing.iterrows():
        est = estimator.estimate_reopening(incident_id, at=cur["t"])
        points.append(TimelinePoint(
            time=cur["t"].to_pydatetime(), title=cur["summary_en"], kind=cur["kind"],
            duration_type=cur["duration_type"],
            official_end=cur["announced_end"].to_pydatetime() if pd.notna(cur["announced_end"]) else None,
            estimate=est, what_changed=_what_changed(prev, cur, False),
        ))
        prev = cur
    if pd.notna(h["real_end"]):
        end_v = _version_at(incident_id, h["real_end"])
        points.append(TimelinePoint(
            time=h["real_end"].to_pydatetime(), title=end_v["summary_en"], kind="resumed",
            duration_type=end_v["duration_type"], official_end=None,
            estimate=estimator.estimate_reopening(incident_id, at=h["real_end"]),
            what_changed=_what_changed(prev, end_v, True),
        ))
    first = v.iloc[0]
    return IncidentTimeline(
        incident_id=incident_id,
        title=(ongoing.iloc[0] if len(ongoing) else first)["summary_en"],
        reason=_reason_labels().get(h["reason_id"], h["reason_id"]),
        affected_section=h["section"],
        start=h["start"].to_pydatetime(),
        real_end=h["real_end"].to_pydatetime() if pd.notna(h["real_end"]) else None,
        points=points,
    )


def shift_to_now(model: BaseModel, at: pd.Timestamp, now: datetime | None = None) -> BaseModel:
    """Copy of `model` with every datetime moved by (now - at)."""
    now = now or datetime.now().astimezone()
    delta = now - at.to_pydatetime()
    # Round to 5 min so that "18:00" stays a round time once shifted.
    delta = timedelta(minutes=5 * round(delta.total_seconds() / 300))
    return _shift(model, delta)


def _shift(obj, delta: timedelta):
    if isinstance(obj, datetime):
        return obj + delta
    if isinstance(obj, BaseModel):
        return obj.model_copy(update={k: _shift(getattr(obj, k), delta) for k in type(obj).model_fields})
    if isinstance(obj, list):
        return [_shift(x, delta) for x in obj]
    if isinstance(obj, dict):
        return {k: _shift(x, delta) for k, x in obj.items()}
    return obj


def demo_incidents(limit: int = 20) -> list[dict]:
    """Recent usable incidents, those with internal KULT details first."""
    from app.estimation import kult

    h = features.build_incident_history()
    h = h[h["usable"]].sort_values("start", ascending=False).head(limit)
    out = []
    for r in h.itertuples():
        try:
            found = kult.find_kult_case(r.incident_id)[0] is not None
        except FileNotFoundError:
            found = False
        out.append({
            "incident_id": r.incident_id,
            "section": r.section,
            "reason": _reason_labels().get(r.reason_id, r.reason_id),
            "kind": r.kind,
            "start": r.start.to_pydatetime(),
            "real_duration_min": int(round(r.real_duration_min)),
            "first_announcement_error_min": None if pd.isna(r.first_announced_error_min)
            else int(round(r.first_announced_error_min)),
            "versions": int(r.n_versions_ongoing),
            "internal_details": bool(found),
        })
    return sorted(out, key=lambda d: not d["internal_details"])

