"""Build and rank alternatives for the 4 categories: fastest, nearby, comfort, wait.

Each candidate gets a *cost* in "equivalent minutes" per category (lower is
better). The list is sorted by cost and ``score`` = 100 for the best option,
minus one point per extra equivalent minute (floored at 0).

Weights (equivalent minutes):

| term                     | fastest | nearby | comfort |
|--------------------------|---------|--------|---------|
| arrival delay (per min)  | 1       | 1      | 1       |
| per transfer             | 3       | 3      | 12      |
| per regular bus leg      | 0       | 0      | 8       |
| replacement bus          | 10      | 10     | 30      |
| per walking minute       | 0       | 0      | 0.5     |
| per km left to the dest. | -       | 4      | -       |

Options that contradict the preferences stay in the list, ranked with a heavy
penalty and with ``disabled_reason`` set (the replacement bus is always kept
while it runs):
``avoid_replacement_bus`` (+60), ``max_transfers`` (+30 per extra transfer),
``deadline`` (+120). "Wait" options get a risk penalty of half the gap
between the official reopening time and our conservative estimate.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta

from app.models import (
    Alternative,
    AlternativeCategory,
    AlternativesResponse,
    Journey,
    Preferences,
)
from app.routing.disruption import DisruptionContext, get_disruption
from app.routing.ojp_client import OJPClient, to_model_leg
from app.routing.planner import Candidate, PlanResult, minutes_between, plan
from app.routing.ticket_validity import check_ticket

log = logging.getLogger(__name__)

MAX_PER_CATEGORY = 5
MAX_GAP_TO_BEST = 90  # drop options more than this many equivalent minutes behind the best (keep >= 2)

WEIGHTS = {
    AlternativeCategory.FASTEST: dict(transfer=3, bus=0, replacement=10, walk=0, km=0),
    AlternativeCategory.NEARBY: dict(transfer=3, bus=0, replacement=10, walk=0, km=4),
    AlternativeCategory.COMFORT: dict(transfer=12, bus=8, replacement=30, walk=0.5, km=0),
}
PENALTY_AVOIDED_BUS = 60
PENALTY_EXTRA_TRANSFER = 30
PENALTY_DEADLINE = 120


def find_alternatives(journey: Journey, prefs: Preferences, client: OJPClient | None = None,
                      sit=None) -> AlternativesResponse:
    """Ranked alternatives for the journey in its live situation (app/situation.py).

    `sit` defaults to the journey's own situation (commuter checks pass the demo
    incident's). Raises OJPError when OJP is unreachable (no mock fallback).
    """
    from app import situation as situations

    client = client or OJPClient()
    sit = sit or situations.get(journey.id)
    ctx = get_disruption(journey, client, sit)
    result = plan(journey, prefs, ctx, client, now=sit.clock if sit else None)
    return build_response(journey, prefs, result, ctx)


def build_response(
    journey: Journey, prefs: Preferences, result: PlanResult, ctx: DisruptionContext | None
) -> AlternativesResponse:
    at_dest = [c for c in result.candidates if c.at_destination]
    nearby = [c for c in result.candidates
              if not c.at_destination and c.distance_km <= prefs.destination_radius_km]
    nearby = _best_per_stop(nearby, journey) or at_dest

    by_category = {
        AlternativeCategory.FASTEST: _rank(AlternativeCategory.FASTEST, at_dest, journey, prefs),
        AlternativeCategory.NEARBY: _rank(AlternativeCategory.NEARBY, nearby, journey, prefs),
        AlternativeCategory.COMFORT: _rank(AlternativeCategory.COMFORT, at_dest, journey, prefs),
        AlternativeCategory.WAIT: _rank_wait(result.wait, journey, ctx),
    }
    if ctx is None:  # no disruption (or the line has reopened): normal service
        for alts in by_category.values():
            for alt in alts:
                alt.certainty_reason = "Normal service"
    return AlternativesResponse(journey_id=journey.id, by_category=by_category)


def _best_per_stop(cands: list[Candidate], journey: Journey) -> list[Candidate]:
    best: dict[str, Candidate] = {}
    for c in cands:
        cur = best.get(c.final_stop.id)
        if cur is None or c.trip.arrival < cur.trip.arrival:
            best[c.final_stop.id] = c
    return list(best.values())


def cost(category: AlternativeCategory, c: Candidate, journey: Journey) -> float:
    w = WEIGHTS[category]
    value = minutes_between(journey.arrival, c.trip.arrival)
    value += w["transfer"] * c.trip.transfers
    value += w["bus"] * sum(1 for leg in c.trip.pt_legs if leg.mode == "bus")
    value += w["replacement"] * (1 if c.uses_replacement_bus else 0)
    value += w["walk"] * c.walk_minutes
    value += w["km"] * c.distance_km
    return value


def _preference_penalty(c: Candidate, prefs: Preferences) -> float:
    penalty = 0.0
    if prefs.avoid_replacement_bus and c.uses_replacement_bus:
        penalty += PENALTY_AVOIDED_BUS
    if prefs.max_transfers is not None and c.trip.transfers > prefs.max_transfers:
        penalty += PENALTY_EXTRA_TRANSFER * (c.trip.transfers - prefs.max_transfers)
    if prefs.deadline is not None and c.trip.arrival > _aware(prefs.deadline, c.trip.arrival):
        penalty += PENALTY_DEADLINE
    return penalty


def _aware(t: datetime, like: datetime) -> datetime:
    return t if t.tzinfo else t.replace(tzinfo=like.tzinfo)


def _rank(category: AlternativeCategory, cands: list[Candidate], journey: Journey,
          prefs: Preferences) -> list[Alternative]:
    if not cands:
        return []
    # Options that contradict the preferences stay in the list (ranked last, with
    # the reason), so the traveller sees that e.g. a replacement bus exists.
    scored = sorted(((cost(category, c, journey) + _preference_penalty(c, prefs), c) for c in cands),
                    key=lambda x: (x[0], x[1].trip.arrival))
    kept = scored[:MAX_PER_CATEGORY]
    bus = next((x for x in scored if x[1].uses_replacement_bus), None)
    if bus and bus not in kept and category != AlternativeCategory.NEARBY:
        kept.append(bus)  # always show the replacement bus while it runs
    kept = _kept_after_gap(kept, [bus] if bus else [])
    alts = _to_alternatives(category, kept)
    for alt, (_, c) in zip(alts, kept):
        alt.disabled_reason = _preference_conflict(c, prefs)
    return alts


def _rank_wait(cands: list[Candidate], journey: Journey, ctx: DisruptionContext | None) -> list[Alternative]:
    scored = []
    for c in cands:
        value = minutes_between(journey.arrival, c.trip.arrival)
        if ctx is not None and c.source == "wait":
            # relying on the official time: add part of the risk that it slips
            value += 0.5 * max(0.0, minutes_between(ctx.reopening_official, ctx.reopening_safe))
        scored.append((value, c))
    scored.sort(key=lambda x: x[0])
    return _to_alternatives(AlternativeCategory.WAIT, _kept_after_gap(scored[:MAX_PER_CATEGORY], []))


def _preference_conflict(c: Candidate, prefs: Preferences) -> str | None:
    if prefs.avoid_replacement_bus and c.uses_replacement_bus:
        return "You chose to avoid replacement buses"
    if prefs.max_transfers is not None and c.trip.transfers > prefs.max_transfers:
        return f"More than {prefs.max_transfers} change(s)"
    return None


def _kept_after_gap(scored: list[tuple[float, Candidate]], keep: list) -> list[tuple[float, Candidate]]:
    if not scored:
        return []
    best = scored[0][0]
    return [x for i, x in enumerate(scored) if i < 2 or x[0] - best <= MAX_GAP_TO_BEST or x in keep]


def _to_alternatives(category: AlternativeCategory, scored: list[tuple[float, Candidate]]) -> list[Alternative]:
    if not scored:
        return []
    best = scored[0][0]
    out = []
    for i, (value, c) in enumerate(scored, start=1):
        alt = Alternative(
            id=f"{category.value}-{i}",
            category=category,
            legs=[to_model_leg(leg) for leg in c.trip.legs if not _is_noise(leg)],
            arrival=c.trip.arrival,
            final_stop=c.final_stop,
            distance_to_destination_km=c.distance_km,
            transfers=c.trip.transfers,
            score=round(max(0.0, 100.0 - (value - best)), 1),
        )
        alt.ticket_valid, alt.ticket_hint = check_ticket(alt)
        _add_display_fields(alt, category, c)
        out.append(alt)
    return out


def _add_display_fields(alt: Alternative, category: AlternativeCategory, c: Candidate) -> None:
    """Optional fields of the contract that the frontend shows (title, departure, certainty)."""
    rides = [leg for leg in alt.legs if leg.mode not in ("walk", "wait")]
    alt.departure = (rides or alt.legs)[0].departure if alt.legs else None
    alt.uses_blocked_line = category == AlternativeCategory.WAIT
    if category == AlternativeCategory.WAIT:
        alt.title = "Wait for the line to reopen"
        alt.certainty, alt.certainty_reason = "uncertain", "Depends on when the line reopens"
        return
    bus = next((leg for leg in rides if leg.mode == "replacement_bus"), None)
    if bus:
        alt.title = f"Replacement bus {bus.from_stop.name} - {bus.to_stop.name}"
    elif not c.at_destination:
        alt.title = f"Get off at {alt.final_stop.name}"
    elif len(rides) > 1:
        alt.title = f"Go via {rides[0].to_stop.name}"
    else:
        alt.title = f"Direct {rides[0].line or 'connection'}" if rides else "Alternative route"
    if not c.at_destination:
        alt.certainty = "likely"
        alt.certainty_reason = f"Ends {c.distance_km:.1f} km from your destination"
    elif c.uses_replacement_bus:
        alt.certainty, alt.certainty_reason = "likely", "Replacement buses can be slowed by traffic"
    else:
        alt.certainty, alt.certainty_reason = "safe", "Avoids the blocked section"


def _is_noise(leg) -> bool:
    """Zero-length walks inside the same station."""
    return leg.mode == "walk" and leg.board.name == leg.alight.name and leg.arrival - leg.departure <= timedelta(minutes=5)


def score(alt: Alternative, prefs: Preferences) -> float:
    """Kept for compatibility: the score is computed in find_alternatives()."""
    return alt.score
