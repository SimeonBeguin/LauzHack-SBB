"""Build and rank alternatives for the 4 categories: fastest, nearby, comfort, wait."""

from datetime import datetime, timedelta

from app.models import (
    Alternative,
    AlternativeCategory,
    AlternativesResponse,
    Journey,
    Preferences,
    Stop,
)


def find_alternatives(journey: Journey, prefs: Preferences) -> AlternativesResponse:
    # TODO:
    # 1. FASTEST: OJP trip search origin -> destination, avoiding the blocked section
    # 2. NEARBY:  OJP searches to stops_within_radius(destination, prefs.destination_radius_km)
    # 3. COMFORT: re-rank by transfers, no replacement bus, accessibility
    # 4. WAIT:    planned route + estimate_reopening() as a real option
    # Then apply prefs (deadline, avoid_replacement_bus) and score/sort each list.
    return _mock_response(journey)


def score(alt: Alternative, prefs: Preferences) -> float:
    # TODO: weights per category
    raise NotImplementedError


def _mock_response(journey: Journey) -> AlternativesResponse:
    base = journey.arrival
    dest = journey.destination

    def alt(i: str, cat: AlternativeCategory, delay: int, transfers: int, km: float = 0.0) -> Alternative:
        return Alternative(
            id=i, category=cat, arrival=base + timedelta(minutes=delay), final_stop=dest,
            distance_to_destination_km=km, transfers=transfers, ticket_valid=True,
            ticket_hint="MOCK: your ticket is valid on this route",
        )

    return AlternativesResponse(
        journey_id=journey.id,
        by_category={
            AlternativeCategory.FASTEST: [alt("f1", AlternativeCategory.FASTEST, 25, 2), alt("f2", AlternativeCategory.FASTEST, 40, 1)],
            AlternativeCategory.NEARBY: [alt("n1", AlternativeCategory.NEARBY, 15, 1, 6.5)],
            AlternativeCategory.COMFORT: [alt("c1", AlternativeCategory.COMFORT, 55, 0)],
            AlternativeCategory.WAIT: [alt("w1", AlternativeCategory.WAIT, 70, 0)],
        },
    )
