# Backend

Python 3.10+ · FastAPI · pandas · httpx. It turns the raw disruption data and the
OJP 2.0 timetable into answers the app can show: is my train running, when will
the line probably reopen, what can I do instead, and should I be warned.

Run it from the repository root (API docs at http://localhost:8000/docs):

```bash
python3 -m venv backend/.venv
backend/.venv/bin/pip install -r backend/requirements.txt
OJP_MODE=replay backend/.venv/bin/uvicorn app.main:app --app-dir backend --reload
backend/.venv/bin/python -m pytest backend/tests        # 37 tests, offline
```

Settings come from `.env` at the repo root (see `.env.example`): `OJP_API_KEY`,
`TOMTOM_API_KEY` (optional), `OJP_MODE`, `DATA_DIR` (default `./Daten`).

## One live situation drives everything

`app/situation.py` holds the state of the incident on each demo journey: the
clock, the end time announced by SBB, replacement buses, the published updates
and the reopening. The presenter panel changes it (`POST /situation/{id}`), and
the status, the estimate, the alternatives and the alerts are all recomputed
from it, so they never disagree.

| Journey | Incident | What the presenter can change |
|---|---|---|
| `demo-zh` Zürich HB → Hinwil, S14 17:42 | Simulated interruption Uster – Wetzikon ZH. Its public messages are those of the real incident on the same section (11.06.2024), moved to the demo's times | Clock, announced end, replacement buses, reopening |
| `demo-1` Lausanne → Bern, IC 1 17:20 | Real fire Puidoux – Vauderens of 25.09.2026, replayed version by version from `Daten/` | Clock only ("next SBB update") |

## Modules

```
app/
├── main.py              FastAPI app and routers
├── config.py            settings (.env)
├── models.py            the data contract, mirrored in frontend/src/types.ts
├── mock_data.py         the two demo journeys
├── situation.py         live situation of each demo incident (see above)
├── api/                 HTTP endpoints, thin
├── estimation/          when will the line reopen?
├── routing/             what else can I take?
├── notifications/       commuter alerts
└── prevention/          warn before it goes wrong (booked trips, bus delays, reliability)
```

### `estimation/`: when will the line reopen?

The SBB end time stays the headline; we add an honest range and probabilities
learned from past incidents.

- `loaders.py` reads the three sources in `Daten/` (public liveticker with its audit
  trail, internal KULT ticker, VIA event reports).
- `features.py` rebuilds the history of each incident: real start (VIA creation),
  real end (first `ENDED`), every announced end. 496 usable incidents; the first
  announcement is too optimistic in 68 % of them.
- `estimator.py` finds past incidents **still ongoing at the same elapsed time**
  (weighted by cause and kind) and applies their gap between announced and real
  end to today's announcement. Weighted quantiles give the range, the CDF gives
  "P(over by 18:00)". The range always contains the official time while it has
  not passed.
- `evaluation.py` back-tests it on 2026 without looking at the future
  (`python -m app.estimation.evaluation` from `backend/`): pinball loss 38.8 min
  vs 46.5 min for the SBB announcement alone, and calibrated quantiles (real end
  before our median in 56 % of cases). See `docs/calibration-2026.png`.
- `kult.py` matches a public incident with the internal KULT case (time, place,
  cause) and extracts replacement buses, cancelled trains, recommendations and
  ticket goodwill.
- `replay.py` replays a past incident as if it were live, and returns the public
  messages travellers saw at a given moment (shown in the app's "Details").

### `routing/`: what else can I take?

`POST /alternatives` → `ranking.find_alternatives()`:

1. `disruption.py` resolves the blocked section of the situation (stop ids and
   the stations in between).
2. `planner.py` runs about 13 OJP searches in parallel: base trip, "not via" the
   section, detour hubs, stations near the destination (`service_points.py`),
   replacement bus over the section (timed with TomTom traffic, `road_traffic.py`)
   and "wait" (first train after the announced end, and after our safer estimate).
   Any trip that still crosses the section is dropped.
3. `ranking.py` sorts four lists (fastest, nearby, comfort, wait) and
   `ticket_validity.py` adds a ticket hint to each option.

`ojp_client.py` talks to OJP 2.0 and can record and replay its answers
(`OJP_MODE`):

| Mode | Behaviour |
|---|---|
| `live` | call the API (key needed) |
| `record` | call the API and save every answer in `data/ojp_recordings/` |
| `replay` | offline: recorded answers only, dates shifted to the requested day |
| `auto` | replay when recorded, otherwise call and record |

The recordings in `data/ojp_recordings/` cover both demos, so `replay` runs
without a key or network.

### `notifications/`: commuter alerts

A commuter registers a regular trip (`subscriptions.py`). From **3 h before** the
usual departure, `watcher.py` checks it against the live situations: if the line
of the trip is interrupted, it sends an alert, worded by how likely the
commuter's own train is to be hit (estimate curve at the time the train reaches
the section):

| Chance the line is still closed | Alert |
|---|---|
| ≥ 70 % | "Your 17:42 will probably not run", with the best alternative |
| 20–70 % | "Your 17:42 to Hinwil may be affected" |
| < 20 % | "Disruption on your line … your train should not be affected" |
| line reopened | "Line reopened" |

A new alert is only sent when the message changes or SBB announces a new end.

### `prevention/`: before it goes wrong

- `bookings.py`: trips paid in advance (e.g. Supersaver). From 3 h before, checks
  the booked connection against incidents, bus delays and tight changes, and
  alerts with other ways to get there.
- `bus_delay.py`: predicts the delay of a bus from the live traffic still ahead
  of it (TomTom), before the official real-time data shows it.
- `reliability.py`: reliability gauge of an itinerary from the usual traffic at
  that hour (used for the % next to "Reliable" and for "Plan a trip").

## API

| Method | Path | What |
|---|---|---|
| GET / POST | `/situation/{journey_id}` | live situation; actions `advance`, `set_official_end`, `replacement_bus`, `resume`, `next_update`, `reset` |
| GET | `/journeys/{journey_id}/status` | status of the journey and the reopening estimate |
| GET | `/journeys/{journey_id}/details` | internal KULT details and the public SBB messages |
| POST | `/alternatives` | ranked alternatives for the journey and preferences |
| POST / GET / DELETE | `/commuters/trips` | regular trips |
| GET | `/commuters/{user_id}/alerts` | commuter alerts (with reasons, trains on the line, options) |
| POST / GET / DELETE | `/prevention/bookings` | booked trips |
| GET | `/prevention/{user_id}/booking-alerts` | booked-trip alerts |
| POST | `/prevention/plan` | trips ranked by reliability |
| GET | `/prevention/bus-delay` | bus delay forecast from live traffic |
| GET | `/incidents/{id}/timeline`, `/status`, `/risk`, `/details` | the estimation on any past incident of the data |
| GET | `/stops?q=` | stations by name |

## Tests

`tests/` (pytest, offline with the recordings): API smoke tests, estimation on
the real data, routing on the demo journeys, commuter alerts, and the prevention
checks with fake OJP / traffic answers. The estimation tests are skipped when
`Daten/` is missing.
