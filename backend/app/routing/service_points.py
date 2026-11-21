"""Stops near the destination, for the "within x km of destination" category.

Source: SBB service points (Dienststellen) with coordinates, e.g. the
"service-points-full" dataset on data.sbb.ch / opentransportdata.swiss.
"""

from app.models import Stop


def stops_within_radius(lat: float, lon: float, radius_km: float) -> list[Stop]:
    # TODO: load the service points once, haversine filter, sort by distance
    raise NotImplementedError
