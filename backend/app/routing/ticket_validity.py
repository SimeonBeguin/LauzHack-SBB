"""Tell the user whether their ticket is valid on an alternative route.

Simple rules (to verify on the SBB passenger rights page before the pitch):
- During a disruption a normal point-to-point ticket is not tied to a train:
  any other route to the same destination is accepted, replacement buses included.
- Supersaver tickets lose their train binding when the train is delayed/cancelled.
- Arriving at another stop than the destination ("within x km") is covered up
  to that stop, but a local bus / other fare zone for the last part may need
  an extra ticket.
- GA (general abonnement) is valid everywhere.
- The exact rule per incident lives in the internal KULANZMASNAHMEN module
  (workstream A could pass it along later).
"""

from __future__ import annotations

from app.models import Alternative, AlternativeCategory

AT_DESTINATION_KM = 0.6


def check_ticket(alternative: Alternative, ticket_type: str | None = None) -> tuple[bool | None, str]:
    ticket = (ticket_type or "").lower()
    if ticket in ("ga", "general_abonnement", "generalabonnement"):
        return True, "Valid: your GA covers every route."

    if alternative.category == AlternativeCategory.WAIT:
        return True, "Valid: same route, just a later train."

    uses_replacement = any(leg.mode == "replacement_bus" for leg in alternative.legs)
    supersaver = ticket in ("supersaver", "sparbillett", "billet_degriffe")
    prefix = "Valid: your supersaver is no longer tied to your train. " if supersaver else "Valid: "

    if alternative.distance_to_destination_km <= AT_DESTINATION_KM:
        if uses_replacement:
            return True, prefix + "replacement buses are included in your ticket."
        return True, prefix + "during a disruption you may take another route to the same destination."

    km = alternative.distance_to_destination_km
    return None, (
        f"Valid to {alternative.final_stop.name}. The last {km:.1f} km "
        "(local bus or another fare zone) may need an extra ticket."
    )
