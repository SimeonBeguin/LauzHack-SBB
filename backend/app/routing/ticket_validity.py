"""Tell the user whether their ticket is valid on an alternative route.

During disruptions SBB usually lets tickets be used on alternative routes.
Start with simple rules (same origin/destination zone, GA/half-fare) and a
clear hint text.
"""

from app.models import Alternative


def check_ticket(alternative: Alternative, ticket_type: str | None = None) -> tuple[bool | None, str]:
    # TODO
    raise NotImplementedError
