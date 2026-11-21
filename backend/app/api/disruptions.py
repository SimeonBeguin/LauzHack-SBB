"""Journey status endpoints. Owner: Data & estimation."""

from datetime import datetime

from fastapi import APIRouter

from app.estimation.estimator import estimate_reopening
from app.mock_data import DEMO_INCIDENT_ID, get_journey
from app.models import DisruptionStatus

router = APIRouter(prefix="/journeys", tags=["disruptions"])


@router.get("/{journey_id}/status", response_model=DisruptionStatus)
def journey_status(journey_id: str) -> DisruptionStatus:
    journey = get_journey(journey_id)
    # TODO: find the real incident affecting this journey
    return DisruptionStatus(
        incident_id=DEMO_INCIDENT_ID,
        journey_id=journey.id,
        title="MOCK: Interruption Lausanne - Fribourg",
        reason="Technical fault",
        affected_section="Palézieux - Romont",
        estimate=estimate_reopening(DEMO_INCIDENT_ID),
        last_update=datetime.now().astimezone(),
    )
