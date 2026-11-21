# Routing & OJP (workstream B)

`POST /alternatives` → `ranking.find_alternatives(journey, prefs)`:

1. `disruption.get_disruption()` finds the blocked section: the demo scenario
   `demo-zh` (Zürich HB → Hinwil, interruption **Uster – Wetzikon ZH**) or, for other
   journeys, the `affected_section` text of workstream A's status ("Palézieux - Romont").
2. `planner.plan()` runs ~13 OJP searches in parallel: base search, `NotVia` the
   section entry, `Via` detour hubs, stations within the radius
   (`service_points.py`), section entry + replacement bus (TomTom) + onward trip,
   and "wait" = planned route after the reopening.
   Any trip that still runs through the section is dropped (also trains that pass
   without stopping, detected geometrically).
3. `ranking.py` scores each category (weights in the module docstring), applies
   preferences, adds `ticket_validity` hints. Score 100 = best of its list.

If OJP is unreachable (no key, offline without recordings) the old mock is returned.

## OJP modes (`OJP_MODE` in `.env`)

| mode | behaviour |
|---|---|
| `live` (default) | call the API; trips cached 45 s, location lookups 24 h |
| `record` | call the API and save responses to `backend/data/ojp_recordings/` |
| `replay` | offline, only recordings (dates shifted to the requested day) |
| `auto` | replay if recorded, otherwise live + record |

The `demo-zh` scenario is recorded, so `OJP_MODE=replay` works offline for the demo.
Re-record after changing the search logic: `OJP_MODE=record` then call the endpoint.

## OJP 2.0 gotchas (from the live API)

- Only the first `NotVia` is used, and it only excludes trips that **stop** there.
- `NotVia` only works with sloids (`ch:1:sloid:3125`), not DiDok numbers.
- `Via` + `NotVia` together → `TRIP_NOTRIPFOUND`.
