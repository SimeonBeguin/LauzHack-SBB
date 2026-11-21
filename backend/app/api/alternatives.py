"""Alternative connections. Owner: Routing & OJP."""

from fastapi import APIRouter, HTTPException

from app.mock_data import get_journey
from app.models import AlternativesRequest, AlternativesResponse
from app.routing.ojp_client import OJPError
from app.routing.ranking import find_alternatives

router = APIRouter(prefix="/alternatives", tags=["alternatives"])


@router.post("", response_model=AlternativesResponse)
def alternatives(req: AlternativesRequest) -> AlternativesResponse:
    try:
        return find_alternatives(get_journey(req.journey_id), req.preferences)
    except OJPError as exc:
        raise HTTPException(503, f"Timetable (OJP) unavailable: {exc}")
