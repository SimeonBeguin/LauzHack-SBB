# SBB Disruption Helper (LauzHack)

A **"Need help / disruption mode"** for an SBB-style travel app. When your journey
is disrupted, the app tells you honestly what is going on and what you can do.

## What the product does

1. **Journey status with an honest estimate.** The official SBB reopening time
   stays the headline. Under it we show a statistical range ("likely between
   18:10 and 18:40") learned from similar past incidents in the liveticker data.
   The range never contradicts the official time.
2. **Personalise.** A few quick questions with sensible defaults: arrive within
   10 km of the destination, no deadline, avoid replacement buses, etc.
3. **Three alternative categories plus "wait"**, each opening a ranked list:
   - **Fastest arrival** at the destination
   - **Close to destination**: stops within *x* km (SBB service point coordinates + OJP 2.0 searches)
   - **Most comfortable**: fewer transfers, no bus
   - **Wait**: staying put is a real option, using the reopening estimate
4. **Ticket validity hint** on each alternative.
5. **Push notifications for commuters** who register a regular trip, including
   an early alert when an *earlier* train on the same line is hit.
6. *(Optional)* Real-time road traffic (TomTom / HERE) to correct replacement bus times.

UI mockup: [`docs/mode-perturbation-v1.png`](docs/mode-perturbation-v1.png).
Data notes (French): [`docs/data-analysis-fr.md`](docs/data-analysis-fr.md).
Full team discussion summary, to give your AI assistant as context: [`docs/PROJECT_CONTEXT.md`](docs/PROJECT_CONTEXT.md).

## Stack

| Part     | Tech                                      |
|----------|-------------------------------------------|
| Backend  | Python 3.10+, FastAPI, pandas, httpx      |
| Frontend | React 18 + TypeScript + Vite              |
| Data     | Provided CSV/XLSX in `Daten/` (not committed), OJP 2.0 API |

Everything currently returns **mock data**, so all three parts can be built in
parallel and connected later. Look for `TODO` and `MOCK` in the code.

## Project structure

```
.
├── README.md
├── .env.example            # copy to .env, add your API keys (never commit .env)
├── Daten/                  # provided hackathon data (git-ignored, share it locally)
├── docs/                   # mockup and data notes
├── notebooks/              # [A] data exploration
├── backend/
│   ├── requirements.txt
│   ├── tests/test_api.py   # smoke tests for every endpoint
│   └── app/
│       ├── main.py         # FastAPI app, wires the routers
│       ├── config.py       # settings from env vars / .env
│       ├── models.py       # ★ shared data contract (all three)
│       ├── mock_data.py    # demo journey Lausanne → Fribourg
│       ├── api/
│       │   ├── disruptions.py    # [A] GET  /journeys/{id}/status
│       │   ├── alternatives.py   # [B] POST /alternatives
│       │   └── notifications.py  # [C] /commuters/trips, /commuters/{user}/notifications
│       ├── estimation/           # [A] data & reopening estimate
│       │   ├── loaders.py        #     read Daten/ CSV + XLSX
│       │   ├── features.py       #     incident history, similar incidents
│       │   └── estimator.py      #     estimate_reopening()
│       ├── routing/              # [B] alternatives
│       │   ├── ojp_client.py     #     OJP 2.0 trip / location requests
│       │   ├── service_points.py #     stops within x km of destination
│       │   ├── ranking.py        #     build + rank the 4 categories
│       │   ├── ticket_validity.py#     ticket hint
│       │   └── road_traffic.py   #     optional TomTom / HERE
│       └── notifications/        # [C] commuter alerts
│           ├── subscriptions.py  #     registered trips (in memory)
│           └── watcher.py        #     match incidents to trips, earlier-train alert
└── frontend/
    ├── package.json
    └── src/
        ├── App.tsx               # screen flow
        ├── types.ts              # ★ mirror of backend/app/models.py
        ├── api/client.ts         # calls the backend (or mocks)
        ├── mocks/mockData.ts     # frontend-only mock data
        ├── components/           # EstimateBanner, AlternativeCard
        └── screens/              # JourneyStatus, Personalise, Alternatives,
                                  # AlternativeList, CommuterSetup
```

## Who owns what

| Workstream | Owner | Folders | First goals |
|---|---|---|---|
| **A. Data & estimation** | _TBD_ | `notebooks/`, `backend/app/estimation/`, `api/disruptions.py` | Load the liveticker audit data, rebuild real incident durations, compute a range from similar incidents, plug it into `estimate_reopening()` |
| **B. Routing & OJP** | _TBD_ | `backend/app/routing/`, `api/alternatives.py` | Get an OJP API key, make `OJPClient.trip()` work, radius search on service points, rank the 4 categories, ticket hint |
| **C. Frontend, UX & notifications** | _TBD_ | `frontend/`, `backend/app/notifications/`, `api/notifications.py` | Build the screens from the mockup, Personalise flow, commuter trip registration, push alerts (incl. earlier train on the same line) |

**Shared:** `backend/app/models.py` and `frontend/src/types.ts` are the contract
between the three parts. Agree on changes together and update both files in the
same commit.

## Getting started

```bash
cp .env.example .env        # then fill in OJP_API_KEY (and optional TomTom/HERE)
# put the provided data in ./Daten (same layout as received)
```

**Backend** (http://localhost:8000, API docs at http://localhost:8000/docs):

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload
pytest                      # smoke tests
```

**Frontend** (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev                 # uses the backend
VITE_USE_MOCKS=true npm run dev   # works without the backend
```

## API (current stubs)

| Method | Path | Returns |
|---|---|---|
| GET | `/health` | `{"status": "ok"}` |
| GET | `/journeys/{journey_id}/status` | `DisruptionStatus` (incident + `ReopeningEstimate`) |
| POST | `/alternatives` | body `{journey_id, preferences}` → `AlternativesResponse` (list per category) |
| POST | `/commuters/trips` | register a `CommuterTrip` |
| GET | `/commuters/trips?user_id=` | list registered trips |
| DELETE | `/commuters/trips/{trip_id}` | remove a trip |
| GET | `/commuters/{user_id}/notifications` | `Notification[]` |

Use `demo-1` as the journey id for now.

## Data sources

- `Daten/extern-liveticker/`: public liveticker (incidents, full audit trail, messages, causes). See its README.
- `Daten/intern-liveticker/`: internal KULT ticker (cases, categories, messages, logs). See `README-intern.md`.
- `Daten/Ereignismeldungen/`: VIA event reports (XLSX).
- [opentransportdata.swiss OJP 2.0](https://opentransportdata.swiss/en/cookbook/open-journey-planner-ojp/): trip planning (API key in `.env`).
- SBB service points (stops with coordinates) for the radius search.

The `Daten/` folder is git-ignored because it contains internal data. Do not push it.
