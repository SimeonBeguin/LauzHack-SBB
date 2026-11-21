"""Turn raw incidents into a clean table of past incidents with their real duration.

Target table (one row per past incident), suggested columns:
    incident_id, reason_id, reason_group, line / section, start, real_end,
    announced_end_first, announced_end_last, real_duration_min, weekday, hour
"""

import pandas as pd


def build_incident_history(incidents: pd.DataFrame, audit: pd.DataFrame) -> pd.DataFrame:
    # TODO: derive real start/end from the audit trail (lifecycle changes, DELETED = resolved?)
    raise NotImplementedError


def similar_incidents(history: pd.DataFrame, reason_id: str, section: str | None = None) -> pd.DataFrame:
    # TODO: same cause, same region/line, similar time of day...
    raise NotImplementedError
