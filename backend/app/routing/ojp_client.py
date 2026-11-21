"""Minimal client for the opentransportdata.swiss OJP 2.0 API.

Docs: https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/
Auth: "Authorization: Bearer <OJP_API_KEY>" (from .env, never hardcoded).
Requests and responses are XML (OJP 2.0 schema).
"""

from datetime import datetime

import httpx

from app.config import settings


class OJPClient:
    def __init__(self, api_key: str | None = None, endpoint: str | None = None):
        self.api_key = api_key or settings.ojp_api_key
        self.endpoint = endpoint or settings.ojp_endpoint

    def _post(self, xml_body: str) -> str:
        if not self.api_key:
            raise RuntimeError("OJP_API_KEY is not set (see .env.example)")
        resp = httpx.post(
            self.endpoint,
            content=xml_body.encode("utf-8"),
            headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/xml"},
            timeout=20,
        )
        resp.raise_for_status()
        return resp.text

    def trip(self, origin_id: str, destination_id: str, departure: datetime, num_results: int = 5):
        """OJPTripRequest. Returns parsed trips (TODO: define the parsed shape)."""
        # TODO: build the OJPTripRequest XML, call self._post, parse with lxml
        raise NotImplementedError

    def location_information(self, name: str):
        """OJPLocationInformationRequest: look up stops by name."""
        # TODO
        raise NotImplementedError
