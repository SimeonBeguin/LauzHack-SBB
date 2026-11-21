"""Estimate when a disrupted line reopens.

Rule: the official SBB end time stays the headline. The statistical range from
similar past incidents is shown around it and never contradicts it.
"""

from datetime import datetime, timedelta

from app.models import ReopeningEstimate


def estimate_reopening(incident_id: str, official_end: datetime | None = None) -> ReopeningEstimate:
    # TODO: look up the incident, find similar past incidents, compute quantiles,
    # then clamp the range so it is consistent with official_end.
    now = datetime.now().astimezone()
    official_end = official_end or now + timedelta(minutes=60)
    return ReopeningEstimate(
        official_end=official_end,
        likely_end_earliest=official_end - timedelta(minutes=10),
        likely_end_latest=official_end + timedelta(minutes=30),
        confidence=0.6,
        similar_incidents_count=0,
        explanation="MOCK: placeholder estimate, not based on data yet",
    )
