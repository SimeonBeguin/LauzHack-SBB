"""Turn the raw liveticker versions into clean tables for the estimator.

Two tables are built from `loaders.load_incident_versions()`:

1. `build_incident_history()`: one row per past incident, with its real
   duration and what SBB announced.
2. `build_snapshots()`: one row per *version* of an incident published while
   it was still ongoing = "what a traveller could see at that moment". This is
   what lets the estimator condition on elapsed time and on the current
   announcement, and what makes a live replay possible.

Definitions (checked on the data):
- start     = VIA creation time (`created_at_source`) of the first version.
              For planned FROM_TO events, `duration_from` if later.
- real_end  = VIA time (`updated_at_source`) of the first `ENDED` version
              after the last `INFO` version (a few incidents are reopened).
              `ENDED` is a proxy: data entry can lag a few minutes.
- announced end of a version = `duration_to` (matches the text in 97 % of
              versions). `duration_at_least` is shifted by 2 h: not used.
              `NONE` / `UNKNOWN` versions have no announced end.
- kind      = interruption / restriction / resumed, from the French title
              ("Interruption A - B", "Restriction A - B", "Trafic rétabli: A - B").
"""

from __future__ import annotations

import re
from functools import lru_cache

import numpy as np
import pandas as pd

from app.estimation import loaders

# Durations outside this window are data-entry artefacts, not real reopenings
# (an incident "ended" before it started, or reopened days later).
MIN_DURATION_MIN = 5
MAX_DURATION_MIN = 72 * 60

DURATION_TYPES_WITH_END = {
    "UNTIL",
    "UNTIL_AT_LEAST",
    "UNTIL_DATE",
    "UNTIL_APPROX_DATE_TIME",
    "UNTIL_AT_LEAST_DATE_TIME",
    "FROM_TO",
}

# Cause groups: used as fallback when a cause has too few past incidents.
REASON_GROUPS: dict[str, str] = {
    # technical fault on the infrastructure
    "EG_010": "infrastructure", "EG_001": "infrastructure", "EG_011": "infrastructure",
    "EG_063": "infrastructure", "EG_140": "infrastructure", "EG_056": "infrastructure",
    "EG_156": "infrastructure",
    "EG_008": "overhead_line",
    "EG_006": "track",
    "EG_014": "train",
    # people / collisions
    "EG_047": "accident", "EG_193": "accident", "EG_030": "accident", "EG_102": "accident",
    "EG_046": "accident", "EG_034": "accident", "EG_028": "accident",
    # third parties, police, fire, obstacles
    "EG_070": "external", "EG_049": "external", "EG_135": "external", "EG_052": "external",
    "EG_100": "external", "EG_110": "external", "EG_192": "external",
    # weather and natural hazards
    "EG_026": "nature", "EG_101": "nature", "EG_025": "nature", "EG_019": "nature",
    "EG_017": "nature", "EG_018": "nature", "EG_020": "nature",
    # planned / exceptional works
    "EG_158": "works", "EG_004": "works",
    # events abroad
    "EG_166": "abroad", "EG_167": "abroad", "EG_168": "abroad",
}

_KIND_PATTERNS = [
    ("resumed", re.compile(r"^\s*Trafic rétabli\s*:?\s*", re.I)),
    ("interruption", re.compile(r"^\s*Interruption\s+", re.I)),
    ("restriction", re.compile(r"^\s*Restriction\s+", re.I)),
]


def reason_group(reason_id: str | None) -> str:
    return REASON_GROUPS.get(reason_id or "", "other")


def parse_summary(summary_fr: str | None) -> tuple[str, str | None, str | None, str | None]:
    """'Interruption Puidoux - Vauderens' -> ('interruption', 'Puidoux - Vauderens', 'Puidoux', 'Vauderens')."""
    text = (summary_fr or "").strip()
    kind = "other"
    for name, pattern in _KIND_PATTERNS:
        if pattern.match(text):
            kind = name
            text = pattern.sub("", text, count=1)
            break
    section = text or None
    if not section:
        return kind, None, None, None
    parts = [p.strip() for p in section.split(" - ")]
    a = parts[0] or None
    b = parts[1] if len(parts) > 1 and parts[1] else None
    return kind, section, a, b


def _add_version_columns(versions: pd.DataFrame) -> pd.DataFrame:
    v = versions.copy()
    parsed = v["summary_fr"].map(parse_summary)
    v["kind"] = parsed.str[0]
    v["section"] = parsed.str[1]
    v["section_from"] = parsed.str[2]
    v["section_to"] = parsed.str[3]
    has_end = v["duration_type"].isin(DURATION_TYPES_WITH_END) & v["duration_to"].notna()
    v["announced_end"] = v["duration_to"].where(has_end)
    # Version timestamp as seen by the traveller: VIA update time, never earlier
    # than the VIA creation time.
    v["t"] = v[["updated_at_source", "created_at_source"]].max(axis=1)
    return v


def _incident_row(g: pd.DataFrame) -> dict:
    g = g.sort_values("last_modified_date")
    first = g.iloc[0]
    life = g["lifecycle"].tolist()

    start = first["created_at_source"]
    if first["duration_type"] == "FROM_TO" and pd.notna(first["duration_from"]):
        start = max(start, first["duration_from"])

    info_idx = [i for i, s in enumerate(life) if s == "INFO"]
    after = info_idx[-1] + 1 if info_idx else 0
    ended_idx = next((i for i in range(after, len(life)) if life[i] == "ENDED"), None)
    real_end = g.iloc[ended_idx]["t"] if ended_idx is not None else pd.NaT

    ongoing = g.iloc[:ended_idx] if ended_idx is not None else g
    ongoing = ongoing[ongoing["lifecycle"] == "INFO"]
    ann = ongoing["announced_end"].dropna()
    kinds = [k for k in ongoing["kind"] if k in ("interruption", "restriction")]
    reason_id = (ongoing["reason_id_fk"].iloc[-1] if len(ongoing) else first["reason_id_fk"])
    named = ongoing[ongoing["section"].notna() & ongoing["kind"].ne("resumed")]
    section_row = named.iloc[-1] if len(named) else first

    duration = (real_end - start).total_seconds() / 60 if pd.notna(real_end) else np.nan

    if ended_idx is None:
        exclusion = "never_ended"
    elif not (MIN_DURATION_MIN <= duration <= MAX_DURATION_MIN):
        exclusion = "implausible_duration"
    elif first["duration_type"] == "FROM_TO" or reason_group(reason_id) == "works":
        exclusion = "planned_works"
    else:
        exclusion = None

    return {
        "incident_id": first["id"],
        "reason_id": reason_id,
        "reason_group": reason_group(reason_id),
        "kind": kinds[0] if kinds else "other",
        "ever_interruption": "interruption" in kinds,
        "section": section_row["section"],
        "section_from": section_row["section_from"],
        "section_to": section_row["section_to"],
        "origin_language": first["origin_language"],
        "start": start,
        "real_end": real_end,
        "real_duration_min": duration,
        "announced_end_first": ann.iloc[0] if len(ann) else pd.NaT,
        "announced_end_last": ann.iloc[-1] if len(ann) else pd.NaT,
        "n_versions_ongoing": len(ongoing),
        "n_announcement_changes": int(ann.ne(ann.shift()).sum() - 1) if len(ann) else 0,
        "first_duration_type": first["duration_type"],
        "weekday": start.weekday(),
        "hour": start.hour,
        "year": start.year,
        "usable": exclusion is None,
        "exclusion_reason": exclusion,
    }


@lru_cache(maxsize=None)
def _history_and_versions() -> tuple[pd.DataFrame, pd.DataFrame]:
    versions = _add_version_columns(loaders.load_incident_versions())
    rows = [_incident_row(g) for _, g in versions.groupby("id", sort=False)]
    history = pd.DataFrame(rows).sort_values("start").reset_index(drop=True)
    history["first_announced_error_min"] = (
        (history["real_end"] - history["announced_end_first"]).dt.total_seconds() / 60
    )
    return history, versions


def build_incident_history(
    incidents: pd.DataFrame | None = None, audit: pd.DataFrame | None = None
) -> pd.DataFrame:
    """One row per past incident.

    Columns: incident_id, reason_id, reason_group, kind, ever_interruption,
    section, section_from, section_to, start, real_end, real_duration_min,
    announced_end_first, announced_end_last, first_announced_error_min,
    n_versions_ongoing, n_announcement_changes, first_duration_type, weekday,
    hour, year, usable, exclusion_reason.

    `usable` is False for incidents that never ended, have an implausible
    duration, or are planned works: keep them out of the statistics.

    The arguments are accepted for backward compatibility; by default the
    data is read (and cached) through `loaders`.
    """
    if incidents is not None and audit is not None:
        versions = pd.concat([audit.assign(is_current=False), incidents.assign(is_current=True)])
        versions = _add_version_columns(
            versions.sort_values(["id", "last_modified_date"]).drop_duplicates(["id", "last_modified_date"], keep="last")
        )
        rows = [_incident_row(g) for _, g in versions.groupby("id", sort=False)]
        return pd.DataFrame(rows).sort_values("start").reset_index(drop=True)
    return _history_and_versions()[0].copy()


def incident_versions() -> pd.DataFrame:
    """All versions with the parsed columns (kind, section, announced_end, t)."""
    return _history_and_versions()[1].copy()


@lru_cache(maxsize=None)
def _snapshots() -> pd.DataFrame:
    history, versions = _history_and_versions()
    v = versions[versions["lifecycle"] == "INFO"].merge(
        history[["incident_id", "start", "real_end", "usable", "reason_group"]],
        left_on="id", right_on="incident_id", how="inner",
    )
    v = v[v["real_end"].isna() | (v["t"] < v["real_end"])]
    snaps = pd.DataFrame({
        "incident_id": v["id"],
        "t": v["t"],
        "start": v["start"],
        "real_end": v["real_end"],
        "usable": v["usable"],
        "reason_id": v["reason_id_fk"],
        "reason_group": v["reason_group"],
        "kind": v["kind"],
        "duration_type": v["duration_type"],
        "announced_end": v["announced_end"],
    })
    snaps["elapsed_min"] = ((snaps["t"] - snaps["start"]).dt.total_seconds() / 60).clip(lower=0)
    snaps["announced_remaining_min"] = (snaps["announced_end"] - snaps["t"]).dt.total_seconds() / 60
    snaps["real_remaining_min"] = (snaps["real_end"] - snaps["t"]).dt.total_seconds() / 60
    snaps["announced_error_min"] = (snaps["real_end"] - snaps["announced_end"]).dt.total_seconds() / 60
    # Several versions can share the same second: keep the last one.
    snaps = snaps.sort_values(["incident_id", "t"]).drop_duplicates(["incident_id", "t"], keep="last")
    snaps["snapshot_rank"] = snaps.groupby("incident_id").cumcount()
    return snaps.reset_index(drop=True)


def build_snapshots() -> pd.DataFrame:
    """One row per ongoing version of every incident (what was known at time t).

    Columns: incident_id, t, start, real_end, usable, reason_id, reason_group,
    kind, duration_type, announced_end, elapsed_min, announced_remaining_min,
    real_remaining_min, announced_error_min, snapshot_rank.
    """
    return _snapshots().copy()
