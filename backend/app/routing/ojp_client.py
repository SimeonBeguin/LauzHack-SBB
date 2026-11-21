"""Client for the opentransportdata.swiss OJP 2.0 API.

Docs: https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/
Auth: "Authorization: Bearer <OJP_API_KEY>" (from .env, never hardcoded).
Requests and responses are XML (OJP 2.0 schema).

Features
- ``trip()``: OJPTripRequest, parsed into ``OJPTrip`` / ``OJPLeg`` objects with
  planned and real-time (estimated) times, intermediate stops, cancellations.
- ``location_information()``: OJPLocationInformationRequest (stops by name).
- Caching: trip results 45 s in memory (real-time data), location lookups
  24 h in memory and on disk (static data).
- Record / replay (env ``OJP_MODE``):
    live    call the API (default)
    record  call the API and save every response under ``OJP_RECORDINGS_DIR``
    replay  only use saved responses (offline demo, no quota). Dates are shifted
            so a recording made on a Monday can be replayed for any other day.
    auto    replay when a recording exists, otherwise call the API and record.

Notes learned from the live API
- Only the *first* ``NotVia`` element is honoured, and it only excludes trips
  that *stop* at that place (trains passing through without stopping are kept).
- ``Via`` combined with ``NotVia`` returns TRIP_NOTRIPFOUND, so we never mix them.
"""

from __future__ import annotations

import hashlib
import json
import logging
import re
import threading
import time
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo

import httpx
from lxml import etree

from app.config import settings
from app.models import Leg, Stop

log = logging.getLogger(__name__)

TZ = ZoneInfo("Europe/Zurich")
NS = {"o": "http://www.vdv.de/ojp", "siri": "http://www.siri.org.uk/siri"}

TRIP_TTL_S = 45  # real-time data: keep it short
LOCATION_TTL_S = 24 * 3600  # static data


class OJPError(RuntimeError):
    """OJP unavailable (no key, network, quota) or no recording in replay mode."""


# ---------------------------------------------------------------------------
# Stop ids
# ---------------------------------------------------------------------------

_SLOID_RE = re.compile(r"ch:1:sloid:(\d+)")


def didok(ref: str | None) -> str | None:
    """Normalise any Swiss stop reference to the 7-digit DiDok number.

    ``ch:1:sloid:3125:2:2`` -> ``8503125``, ``ch:1:sloid:76105`` -> ``8576105``,
    ``8503125`` -> ``8503125``.
    """
    if not ref:
        return None
    m = _SLOID_RE.search(ref)
    if m:
        return f"85{int(m.group(1)):05d}"
    if ref.isdigit():
        return ref
    return ref


def sloid(stop_id: str) -> str:
    """``8503125`` -> ``ch:1:sloid:3125``. NotVia only works with the sloid form."""
    if stop_id.isdigit() and len(stop_id) == 7 and stop_id.startswith("85"):
        return f"ch:1:sloid:{int(stop_id[2:])}"
    return stop_id


# ---------------------------------------------------------------------------
# Parsed shapes
# ---------------------------------------------------------------------------

@dataclass
class OJPCall:
    """One stop of a timed leg (board, intermediate or alight)."""

    stop_id: str  # DiDok number of the parent stop place
    name: str
    arr_planned: datetime | None = None
    arr_estimated: datetime | None = None
    dep_planned: datetime | None = None
    dep_estimated: datetime | None = None
    not_serviced: bool = False

    @property
    def arrival(self) -> datetime | None:
        return self.arr_estimated or self.arr_planned

    @property
    def departure(self) -> datetime | None:
        return self.dep_estimated or self.dep_planned

    @property
    def time(self) -> datetime | None:
        """Best time at this stop (departure if any, else arrival)."""
        return self.departure or self.arrival


@dataclass
class OJPLeg:
    kind: str  # "timed", "transfer", "continuous", "synthetic"
    mode: str  # "train", "bus", "tram", "replacement_bus", "walk", ...
    line: str | None
    calls: list[OJPCall]  # board, intermediates..., alight
    departure_planned: datetime
    arrival_planned: datetime
    departure_estimated: datetime | None = None
    arrival_estimated: datetime | None = None
    cancelled: bool = False
    pt_mode: str | None = None  # raw OJP PtMode (rail, bus, ...)
    situations: list[str] = field(default_factory=list)  # situation summaries
    road_delay_minutes: int | None = None

    @property
    def departure(self) -> datetime:
        return self.departure_estimated or self.departure_planned

    @property
    def arrival(self) -> datetime:
        return self.arrival_estimated or self.arrival_planned

    @property
    def board(self) -> OJPCall:
        return self.calls[0]

    @property
    def alight(self) -> OJPCall:
        return self.calls[-1]

    @property
    def stop_ids(self) -> list[str]:
        return [c.stop_id for c in self.calls]

    @property
    def is_public_transport(self) -> bool:
        return self.kind in ("timed", "synthetic")


@dataclass
class OJPTrip:
    id: str
    legs: list[OJPLeg]

    @property
    def pt_legs(self) -> list[OJPLeg]:
        return [leg for leg in self.legs if leg.is_public_transport]

    @property
    def departure(self) -> datetime:
        return self.legs[0].departure

    @property
    def arrival(self) -> datetime:
        return self.legs[-1].arrival

    @property
    def departure_planned(self) -> datetime:
        return self.legs[0].departure_planned

    @property
    def arrival_planned(self) -> datetime:
        return self.legs[-1].arrival_planned

    @property
    def transfers(self) -> int:
        return max(0, len(self.pt_legs) - 1)

    @property
    def cancelled(self) -> bool:
        return any(leg.cancelled for leg in self.legs)

    @property
    def final_stop_id(self) -> str:
        return self.legs[-1].alight.stop_id

    def signature(self) -> tuple:
        """Identity for de-duplication (same services, same times)."""
        return tuple((leg.line, leg.board.stop_id, leg.departure_planned) for leg in self.pt_legs)


# ---------------------------------------------------------------------------
# Small TTL cache
# ---------------------------------------------------------------------------

class TTLCache:
    def __init__(self, ttl_s: float, max_items: int = 2000):
        self.ttl_s = ttl_s
        self.max_items = max_items
        self._data: dict[str, tuple[float, object]] = {}
        self._lock = threading.Lock()

    def get(self, key: str):
        with self._lock:
            hit = self._data.get(key)
            if hit is None:
                return None
            ts, value = hit
            if time.monotonic() - ts > self.ttl_s:
                del self._data[key]
                return None
            return value

    def set(self, key: str, value) -> None:
        with self._lock:
            if len(self._data) >= self.max_items:
                self._data.pop(next(iter(self._data)))
            self._data[key] = (time.monotonic(), value)

    def clear(self) -> None:
        with self._lock:
            self._data.clear()


# ---------------------------------------------------------------------------
# Record / replay
# ---------------------------------------------------------------------------

_VOLATILE_RE = re.compile(
    r"<siri:RequestTimestamp>[^<]*</siri:RequestTimestamp>|<siri:MessageIdentifier>[^<]*</siri:MessageIdentifier>"
)
_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}(?=T\d{2}:\d{2})|(?<=<OperatingDayRef>)\d{4}-\d{2}-\d{2}")


class Recorder:
    """Stores responses keyed by the request with dates stripped out, so a
    recording can be replayed on another day (all dates are shifted)."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)

    @staticmethod
    def _key_and_date(xml_body: str) -> tuple[str, date | None]:
        body = _VOLATILE_RE.sub("", xml_body)
        dates = _DATE_RE.findall(body)
        req_date = date.fromisoformat(dates[0]) if dates else None
        body = _DATE_RE.sub("DATE", body)
        return hashlib.sha1(body.encode("utf-8")).hexdigest()[:16], req_date

    def _path(self, key: str) -> Path:
        return self.directory / f"{key}.json"

    def load(self, xml_body: str) -> str | None:
        key, req_date = self._key_and_date(xml_body)
        path = self._path(key)
        if not path.exists():
            return None
        rec = json.loads(path.read_text(encoding="utf-8"))
        response = rec["response"]
        if req_date and rec.get("request_date"):
            delta = req_date - date.fromisoformat(rec["request_date"])
            if delta.days:
                response = _DATE_RE.sub(
                    lambda m: (date.fromisoformat(m.group(0)) + delta).isoformat(), response
                )
        return response

    def save(self, xml_body: str, response: str, label: str = "") -> None:
        key, req_date = self._key_and_date(xml_body)
        self.directory.mkdir(parents=True, exist_ok=True)
        rec = {
            "label": label,
            "request_date": req_date.isoformat() if req_date else None,
            "recorded_at": datetime.now(TZ).isoformat(timespec="seconds"),
            "response": response,
        }
        self._path(key).write_text(json.dumps(rec, ensure_ascii=False), encoding="utf-8")


# ---------------------------------------------------------------------------
# XML helpers
# ---------------------------------------------------------------------------

def _ts(dt: datetime) -> str:
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=TZ)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _parse_dt(text: str | None) -> datetime | None:
    if not text:
        return None
    return datetime.fromisoformat(text.replace("Z", "+00:00")).astimezone(TZ)


def _place_ref(stop_id: str, name: str | None = None) -> str:
    name_xml = f"<Name><Text>{escape(name)}</Text></Name>" if name else "<Name><Text>-</Text></Name>"
    return f"<PlaceRef><StopPlaceRef>{escape(stop_id)}</StopPlaceRef>{name_xml}</PlaceRef>"


def _envelope(inner: str) -> str:
    now = _ts(datetime.now(timezone.utc))
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<OJP xmlns="http://www.vdv.de/ojp" xmlns:siri="http://www.siri.org.uk/siri" version="2.0">'
        "<OJPRequest><siri:ServiceRequest>"
        f"<siri:RequestTimestamp>{now}</siri:RequestTimestamp>"
        "<siri:RequestorRef>LauzHack-SBB-disruption-helper</siri:RequestorRef>"
        f"{inner.replace('__NOW__', now).replace('__MSGID__', uuid.uuid4().hex[:12])}"
        "</siri:ServiceRequest></OJPRequest></OJP>"
    )


def build_trip_request(
    origin_id: str,
    destination_id: str,
    when: datetime,
    num_results: int = 5,
    arrive_by: bool = False,
    via: str | None = None,
    not_via: str | None = None,
    origin_name: str | None = None,
    destination_name: str | None = None,
) -> str:
    dep_arr = f"<DepArrTime>{_ts(when)}</DepArrTime>"
    origin = f"<Origin>{_place_ref(origin_id, origin_name)}{'' if arrive_by else dep_arr}</Origin>"
    dest = f"<Destination>{_place_ref(destination_id, destination_name)}{dep_arr if arrive_by else ''}</Destination>"
    extra = ""
    if via:
        extra += f"<Via><ViaPoint><StopPlaceRef>{escape(sloid(via))}</StopPlaceRef></ViaPoint></Via>"
    elif not_via:  # OJP rejects Via + NotVia together
        extra += f"<NotVia><StopPlaceRef>{escape(sloid(not_via))}</StopPlaceRef></NotVia>"
    inner = (
        "<OJPTripRequest>"
        "<siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>"
        "<siri:MessageIdentifier>TR-__MSGID__</siri:MessageIdentifier>"
        f"{origin}{dest}{extra}"
        "<Params>"
        f"<NumberOfResults>{int(num_results)}</NumberOfResults>"
        "<IncludeTrackSections>false</IncludeTrackSections>"
        "<IncludeLegProjection>false</IncludeLegProjection>"
        "<IncludeIntermediateStops>true</IncludeIntermediateStops>"
        "<UseRealtimeData>explanatory</UseRealtimeData>"
        "</Params>"
        "</OJPTripRequest>"
    )
    return _envelope(inner)


def build_location_request(name: str, num_results: int = 5) -> str:
    inner = (
        "<OJPLocationInformationRequest>"
        "<siri:RequestTimestamp>__NOW__</siri:RequestTimestamp>"
        "<siri:MessageIdentifier>LIR-__MSGID__</siri:MessageIdentifier>"
        f"<InitialInput><Name>{escape(name)}</Name></InitialInput>"
        f"<Restrictions><Type>stop</Type><NumberOfResults>{int(num_results)}</NumberOfResults></Restrictions>"
        "</OJPLocationInformationRequest>"
    )
    return _envelope(inner)


def _text(el, path: str) -> str | None:
    found = el.find(path, NS)
    return found.text.strip() if found is not None and found.text else None


_MODE_MAP = {
    "rail": "train",
    "bus": "bus",
    "coach": "bus",
    "tram": "tram",
    "metro": "metro",
    "water": "boat",
    "telecabin": "cable_car",
    "funicular": "funicular",
}


def _leg_mode(service) -> tuple[str, str | None]:
    pt_mode = _text(service, "o:Mode/o:PtMode")
    mode = _MODE_MAP.get(pt_mode or "", pt_mode or "unknown")
    mode_el = service.find("o:Mode", NS)
    submodes = " ".join(
        e.text or "" for e in (mode_el if mode_el is not None else [])
        if isinstance(e.tag, str) and e.tag.endswith("Submode")
    )
    category = (_text(service, "o:ProductCategory/o:ShortName/o:Text") or "").upper()
    if "replacement" in submodes.lower() or category in ("EV", "BEV"):
        mode = "replacement_bus"
    return mode, pt_mode


def _parse_call(el) -> OJPCall:
    ref = _text(el, "siri:StopPointRef")
    return OJPCall(
        stop_id=didok(ref) or "",
        name=_text(el, "o:StopPointName/o:Text") or "",
        arr_planned=_parse_dt(_text(el, "o:ServiceArrival/o:TimetabledTime")),
        arr_estimated=_parse_dt(_text(el, "o:ServiceArrival/o:EstimatedTime")),
        dep_planned=_parse_dt(_text(el, "o:ServiceDeparture/o:TimetabledTime")),
        dep_estimated=_parse_dt(_text(el, "o:ServiceDeparture/o:EstimatedTime")),
        not_serviced=_text(el, "o:NotServicedStop") == "true",
    )


def _parse_situations(root) -> dict[str, str]:
    out: dict[str, str] = {}
    for sit in root.iterfind(".//o:TripResponseContext/o:Situations/o:PtSituation", NS):
        num = _text(sit, "siri:SituationNumber")
        summary = None
        for path in (
            ".//siri:PassengerInformationAction/siri:TextualContent/siri:SummaryContent/siri:SummaryText",
            ".//siri:Summary",
        ):
            summary = _text(sit, path)
            if summary:
                break
        if num:
            out[num] = summary or ""
    return out


def parse_trip_response(xml_text: str) -> list[OJPTrip]:
    root = etree.fromstring(xml_text.encode("utf-8"))
    situations = _parse_situations(root)
    trips: list[OJPTrip] = []
    for trip_el in root.iterfind(".//o:TripResult/o:Trip", NS):
        legs: list[OJPLeg] = []
        for leg_el in trip_el.iterfind("o:Leg", NS):
            timed = leg_el.find("o:TimedLeg", NS)
            if timed is not None:
                calls = [_parse_call(timed.find("o:LegBoard", NS))]
                calls += [_parse_call(e) for e in timed.iterfind("o:LegIntermediate", NS)]
                calls.append(_parse_call(timed.find("o:LegAlight", NS)))
                service = timed.find("o:Service", NS)
                mode, pt_mode = _leg_mode(service)
                line = _text(service, "o:PublishedServiceName/o:Text") or _text(service, "o:PublicCode")
                sit_refs = [
                    situations.get(_text(r, "siri:SituationNumber") or "", "")
                    for r in service.iterfind("o:SituationFullRefs/o:SituationFullRef", NS)
                ]
                legs.append(OJPLeg(
                    kind="timed",
                    mode=mode,
                    pt_mode=pt_mode,
                    line=line,
                    calls=calls,
                    departure_planned=calls[0].dep_planned or calls[0].arr_planned,
                    departure_estimated=calls[0].dep_estimated,
                    arrival_planned=calls[-1].arr_planned or calls[-1].dep_planned,
                    arrival_estimated=calls[-1].arr_estimated,
                    cancelled=_text(service, "o:Cancelled") == "true",
                    situations=[s for s in sit_refs if s],
                ))
                continue
            other = leg_el.find("o:TransferLeg", NS)
            kind = "transfer"
            if other is None:
                other = leg_el.find("o:ContinuousLeg", NS)
                kind = "continuous"
            if other is None:
                continue
            start = other.find("o:LegStart", NS)
            end = other.find("o:LegEnd", NS)
            duration = _parse_duration(_text(other, "o:Duration") or _text(leg_el, "o:Duration"))
            legs.append(OJPLeg(
                kind=kind,
                mode="walk",
                line=None,
                calls=[
                    OJPCall(stop_id=didok(_text(start, "siri:StopPointRef") or _text(start, "o:StopPlaceRef")) or "",
                            name=_text(start, "o:Name/o:Text") or ""),
                    OJPCall(stop_id=didok(_text(end, "siri:StopPointRef") or _text(end, "o:StopPlaceRef")) or "",
                            name=_text(end, "o:Name/o:Text") or ""),
                ],
                # times filled in below from neighbouring legs
                departure_planned=datetime.min.replace(tzinfo=TZ),
                arrival_planned=datetime.min.replace(tzinfo=TZ) + duration,
            ))
        _fill_walk_times(legs)
        if any(leg.kind == "timed" for leg in legs):
            trips.append(OJPTrip(id=_text(trip_el, "o:Id") or uuid.uuid4().hex, legs=legs))
    return trips


def _parse_duration(text: str | None) -> timedelta:
    """ISO 8601 duration like PT1H5M."""
    if not text:
        return timedelta()
    m = re.match(r"P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", text)
    if not m:
        return timedelta()
    d, h, mi, s = (int(x) if x else 0 for x in m.groups())
    return timedelta(days=d, hours=h, minutes=mi, seconds=s)


def _fill_walk_times(legs: list[OJPLeg]) -> None:
    for i, leg in enumerate(legs):
        if leg.kind == "timed":
            continue
        duration = leg.arrival_planned - leg.departure_planned
        prev = next((x for x in reversed(legs[:i]) if x.kind == "timed"), None)
        nxt = next((x for x in legs[i + 1:] if x.kind == "timed"), None)
        if prev is not None:
            leg.departure_planned = prev.arrival_planned
            leg.departure_estimated = prev.arrival_estimated
        elif nxt is not None:
            leg.departure_planned = nxt.departure_planned - duration
            leg.departure_estimated = (nxt.departure_estimated - duration) if nxt.departure_estimated else None
        leg.arrival_planned = leg.departure_planned + duration
        leg.arrival_estimated = (leg.departure_estimated + duration) if leg.departure_estimated else None


def parse_location_response(xml_text: str) -> list[Stop]:
    root = etree.fromstring(xml_text.encode("utf-8"))
    stops = []
    for place in root.iterfind(".//o:PlaceResult/o:Place", NS):
        ref = _text(place, "o:StopPlace/o:StopPlaceRef")
        if not ref:
            continue
        lon = _text(place, "o:GeoPosition/siri:Longitude")
        lat = _text(place, "o:GeoPosition/siri:Latitude")
        stops.append(Stop(
            id=didok(ref) or ref,
            name=_text(place, "o:StopPlace/o:StopPlaceName/o:Text") or _text(place, "o:Name/o:Text") or ref,
            lat=float(lat) if lat else None,
            lon=float(lon) if lon else None,
        ))
    return stops


# ---------------------------------------------------------------------------
# Conversion to the shared contract
# ---------------------------------------------------------------------------

def to_model_leg(leg: OJPLeg, stops: dict[str, Stop] | None = None) -> Leg:
    stops = stops or {}

    def stop(call: OJPCall) -> Stop:
        return stops.get(call.stop_id) or Stop(id=call.stop_id, name=call.name)

    return Leg(
        mode=leg.mode,
        line=leg.line,
        from_stop=stop(leg.board),
        to_stop=stop(leg.alight),
        departure=leg.departure,
        arrival=leg.arrival,
        road_delay_minutes=leg.road_delay_minutes,
    )


# ---------------------------------------------------------------------------
# Client
# ---------------------------------------------------------------------------

class OJPClient:
    _trip_cache = TTLCache(TRIP_TTL_S)
    _location_cache = TTLCache(LOCATION_TTL_S)

    def __init__(
        self,
        api_key: str | None = None,
        endpoint: str | None = None,
        mode: str | None = None,
        recordings_dir: Path | None = None,
    ):
        self.api_key = api_key if api_key is not None else settings.ojp_api_key
        self.endpoint = endpoint or settings.ojp_endpoint
        self.mode = (mode or settings.ojp_mode or "live").lower()
        self.recorder = Recorder(recordings_dir or settings.ojp_recordings_dir)
        self.request_count = 0  # live API calls made by this client

    # -- transport ---------------------------------------------------------

    def _post(self, xml_body: str, label: str = "") -> str:
        if self.mode in ("replay", "auto"):
            recorded = self.recorder.load(xml_body)
            if recorded is not None:
                return recorded
            if self.mode == "replay":
                raise OJPError(f"No OJP recording for request ({label}); run once with OJP_MODE=record")
        if not self.api_key:
            raise OJPError("OJP_API_KEY is not set (see .env.example)")
        try:
            resp = httpx.post(
                self.endpoint,
                content=xml_body.encode("utf-8"),
                headers={"Authorization": f"Bearer {self.api_key}", "Content-Type": "application/xml"},
                timeout=25,
            )
            resp.raise_for_status()
        except httpx.HTTPError as exc:  # never log the request headers (API key)
            raise OJPError(f"OJP request failed: {type(exc).__name__}") from None
        self.request_count += 1
        if self.mode in ("record", "auto"):
            self.recorder.save(xml_body, resp.text, label)
        return resp.text

    # -- requests ----------------------------------------------------------

    def trip(
        self,
        origin_id: str,
        destination_id: str,
        departure: datetime,
        num_results: int = 5,
        arrive_by: bool = False,
        via: str | None = None,
        not_via: str | None = None,
    ) -> list[OJPTrip]:
        """OJPTripRequest. Returns trips sorted by arrival; cancelled ones are dropped."""
        key = f"{origin_id}|{destination_id}|{_ts(departure)}|{num_results}|{arrive_by}|{via}|{not_via}"
        cached = self._trip_cache.get(key)
        if cached is not None:
            return cached
        body = build_trip_request(
            origin_id, destination_id, departure, num_results, arrive_by=arrive_by, via=via, not_via=not_via
        )
        label = f"trip {origin_id}->{destination_id} via={via} not_via={not_via}"
        trips = [t for t in parse_trip_response(self._post(body, label)) if not t.cancelled]
        trips.sort(key=lambda t: t.arrival)
        self._trip_cache.set(key, trips)
        return trips

    def location_information(self, name: str, num_results: int = 5) -> list[Stop]:
        """OJPLocationInformationRequest: look up stops by name (cached 24 h, also on disk)."""
        key = f"{name.strip().lower()}|{num_results}"
        cached = self._location_cache.get(key)
        if cached is not None:
            return cached
        disk = Path(settings.cache_dir) / "ojp_locations.json"
        disk_data: dict = {}
        if disk.exists():
            try:
                disk_data = json.loads(disk.read_text(encoding="utf-8"))
            except ValueError:
                disk_data = {}
        if key in disk_data:
            stops = [Stop(**s) for s in disk_data[key]]
        else:
            stops = parse_location_response(self._post(build_location_request(name, num_results), f"location {name}"))
            disk_data[key] = [s.model_dump() for s in stops]
            disk.parent.mkdir(parents=True, exist_ok=True)
            disk.write_text(json.dumps(disk_data, ensure_ascii=False), encoding="utf-8")
        self._location_cache.set(key, stops)
        return stops
