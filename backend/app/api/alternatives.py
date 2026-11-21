"""Alternative connections. Owner: Routing & OJP."""

from fastapi import APIRouter

from app.mock_data import get_journey
from app.models import AlternativesRequest, AlternativesResponse
from app.routing.ranking import find_alternatives

router = APIRouter(prefix="/alternatives", tags=["alternatives"])


@router.post("", response_model=AlternativesResponse)
def alternatives(req: AlternativesRequest) -> AlternativesResponse:
    return find_alternatives(get_journey(req.journey_id), req.preferences)
