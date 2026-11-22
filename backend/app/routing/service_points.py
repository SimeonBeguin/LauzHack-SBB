"""Stops near the destination, for the "within x km of destination" category.

Source: SBB service points ("Dienststellen gemäss opentransportdata.swiss",
data.sbb.ch), Swiss stop points only. Downloaded once (~2 MB) into
``settings.cache_dir`` (git-ignored) and kept in memory afterwards.
"""

from __future__ import annotations

import csv
import logging
import math
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import httpx

from app.config import settings
from app.models import Stop

log = logging.getLogger(__name__)

DATASET_URL = (
    "https://data.sbb.ch/api/explore/v2.1/catalog/datasets/"
    "dienststellen-gemass-opentransportdataswiss/exports/csv"
)
DATASET_PARAMS = {
    "select": "number,designationofficial,geopos,meansoftransport",
    "where": 'uiccountrycode=85 and stoppoint="true"',
}
CACHE_FILE = "service_points.csv"


@dataclass(frozen=True)
class ServicePoint:
    number: str  # DiDok, e.g. "8503130"
    name: str
    lat: float
    lon: float
    means: frozenset[str]  # {"TRAIN"}, {"BUS"}, {"BUS", "TRAM"}, ...

    @property
    def is_rail(self) -> bool:
        return bool(self.means & {"TRAIN", "RACK_RAILWAY", "METRO"})

    def to_stop(self) -> Stop:
        return Stop(id=self.number, name=self.name, lat=self.lat, lon=self.lon)


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    r = 6371.0088
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def _cache_path() -> Path:
    return Path(settings.cache_dir) / CACHE_FILE


def download(path: Path | None = None) -> Path:
    path = path or _cache_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    log.info("Downloading SBB service points to %s", path)
    resp = httpx.get(DATASET_URL, params=DATASET_PARAMS, timeout=120, follow_redirects=True)
    resp.raise_for_status()
    tmp = path.with_suffix(".tmp")
    tmp.write_bytes(resp.content)
    tmp.replace(path)
    return path


@lru_cache(maxsize=1)
def load_service_points() -> tuple[ServicePoint, ...]:
    path = _cache_path()
    if not path.exists():
        download(path)
    points = []
    with path.open(encoding="utf-8-sig", newline="") as fh:
        for row in csv.DictReader(fh, delimiter=";"):
            geo = (row.get("geopos") or "").split(",")
            if len(geo) != 2 or not row.get("number"):
                continue
            try:
                lat, lon = float(geo[0]), float(geo[1])
            except ValueError:
                continue
            means = frozenset(m for m in (row.get("meansoftransport") or "").split("|") if m)
            points.append(ServicePoint(row["number"], row["designationofficial"], lat, lon, means))
    return tuple(points)


@lru_cache(maxsize=1)
def _by_number() -> dict[str, ServicePoint]:
    return {p.number: p for p in load_service_points()}


def get_service_point(number: str) -> ServicePoint | None:
    return _by_number().get(number)


def get_stop(number: str) -> Stop | None:
    sp = get_service_point(number)
    return sp.to_stop() if sp else None


def distance_km(a: Stop, b: Stop) -> float | None:
    """Distance between two stops, completing missing coordinates from service points."""
    def coords(s: Stop):
        if s.lat is not None and s.lon is not None:
            return s.lat, s.lon
        sp = get_service_point(s.id)
        return (sp.lat, sp.lon) if sp else None

    ca, cb = coords(a), coords(b)
    if not ca or not cb:
        return None
    return haversine_km(*ca, *cb)


def service_points_within_radius(
    lat: float, lon: float, radius_km: float, rail_only: bool = False
) -> list[tuple[ServicePoint, float]]:
    """(service point, distance km) within the radius, closest first."""
    # cheap bounding box before haversine
    dlat = radius_km / 111.0
    dlon = radius_km / (111.0 * max(0.1, math.cos(math.radians(lat))))
    out = []
    for p in load_service_points():
        if abs(p.lat - lat) > dlat or abs(p.lon - lon) > dlon:
            continue
        if rail_only and not p.is_rail:
            continue
        d = haversine_km(lat, lon, p.lat, p.lon)
        if d <= radius_km:
            out.append((p, d))
    out.sort(key=lambda x: x[1])
    return out


def pick_radius_candidates(
    lat: float,
    lon: float,
    radius_km: float,
    limit: int = 6,
    exclude: set[str] | None = None,
    min_spacing_km: float = 1.0,
) -> list[tuple[Stop, float]]:
    """Choose a few stops to run OJP searches to (respecting the API quota).

    Rail stations first (they are the useful arrival points when a line is
    blocked), closest first, skipping stops too close to an already chosen one.
    Bus stops fill up if there are not enough stations.
    """
    exclude = exclude or set()
    chosen: list[tuple[ServicePoint, float]] = []
    pool = service_points_within_radius(lat, lon, radius_km)
    for rail_pass in (True, False):
        for p, d in pool:
            if len(chosen) >= limit:
                break
            if p.number in exclude or p.is_rail != rail_pass:
                continue
            if any(haversine_km(p.lat, p.lon, c.lat, c.lon) < min_spacing_km for c, _ in chosen):
                continue
            chosen.append((p, d))
    return [(p.to_stop(), d) for p, d in chosen]
