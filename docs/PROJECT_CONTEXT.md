# Project context: SBB Disruption Helper (LauzHack 2026)

> **What this file is.** A summary of everything the team discussed with Claude so far
> (data analysis, plan, idea ratings, UX decisions, skeleton). Give it to your own AI
> assistant as context before asking it to help on your part of the project.
> Last updated: 2026-11-21.

---

## 1. The challenge

SBB/CFF challenge at LauzHack: **turn disruption data into the traveller's best next move.**
The difficulty is that information during a disruption is incomplete and keeps changing
(the announced end time is revised several times, the cause can be corrected, a
restriction can turn into a full interruption and back).

Our answer: a **"Need help" / disruption mode** inside an SBB-style app. When one of my
journeys is disrupted I tap "Need help", and the app guides me: what is going on, how
long it will probably last, what my options are, and which one fits me.

---

## 2. The data we were given (`Daten/`, not committed to git)

Full column-by-column analysis (in French): `docs/data-analysis-fr.md`.

| Source | Who sees it | Period | Volume | Languages |
|---|---|---|---|---|
| **Public liveticker** (`Daten/extern-liveticker/`) | Travellers (SBB app/web, major disruptions only) | Mar 2024 → Oct 2026 | 523 incidents, 3,234 messages, ~9,500 historical versions | DE / FR / IT / EN (1 original + 3 machine translations) |
| **Internal KULT ticker** (`Daten/intern-liveticker/`) | SBB staff (train crew, station staff, traffic control centre) | Sept 2026 | 137 cases, 882 messages, 4,372 log rows | One language per message (mostly DE) |
| **VIA event reports** (`Daten/Ereignismeldungen/Ereignismeldungen Via.xlsx`) | Indirectly travellers (disruption info in the timetable); here a technical log | Sept 2026 | 2,710 rows = 168 VIA events | Codes and abbreviations, no free text |

### Keys between the sources

```
VIA.alea_fall_id            == public incident.id        (13-digit VIA event id)
VIA.ereignisgrund (EG_xxx)  == public reason.id == KULT Ereigniskategorie.name
VIA.stoerungs_ort* (85xxxxx) -> SBB service points "NUMBER" (DiDok) for names + coordinates
KULT <-> VIA / public: NO shared id. Match only by date/time + place + cause (heuristic).
```

- Only 13 of the 168 VIA events of Sept 2026 appear in the public liveticker (it only covers major disruptions).
- Matching KULT to VIA by same cause and creation within ±3 h gives a candidate for 88 of 137 KULT cases. Heuristic, not a guaranteed join.
- **Only September 2026 is covered by all three sources.**

### Public liveticker: key facts

- Tables: `reason` (93 cause codes `EG_xxx`) → `incident` (523) → `message` (3,234), plus `incident_audit` (4,782) and `message_audit` (4,722) holding every earlier version.
- **Full history of an incident = audit rows + current row**, ordered by `last_modified_date`. ~8.7 versions per incident on average (max 27).
- `lifecycle`: `INFO` (ongoing) → `ENDED` (over) → `DELETED` (removed). The export only contains closed incidents.
- `duration_type` says how to read the announced end (`UNTIL`, `UNTIL_AT_LEAST`, `UNTIL_APPROX_DATE_TIME`, ...). `duration_to` holds the announced end and **changes often between versions**. `duration_at_least` looks shifted by 2 h in checked examples, so prefer `duration_to`.
- Top causes: EG_010 infrastructure fault (94), EG_047 person accident (71), EG_070 external cause (70), EG_008 overhead line (54), EG_006 track damage (53), EG_014 train blocking the line (51).
- Titles follow templates: `Interruption A - B`, `Restriction A - B`, `Service resumed: A - B`.
- First public message arrives ~39 min (median) after the VIA incident is created.
- Pitfalls: real CSV parser needed (line breaks and emoji inside text), mixed `+0100`/`+0200` offsets (convert to UTC or Europe/Zurich), uneven EN translations.

### Internal KULT ticker: key facts

- `Ereignisfall` (137 cases) → `LivetickerMessage` (882) and `Logs` (4,372). 22 categories, mostly the same `EG_xxx` codes plus internal ones (IT fault, missing-person report).
- **Much earlier and richer than public info**: first internal message ~3 min after case creation (vs ~39 min public).
- Messages are HTML, operational, abbreviated, with train numbers. Personal data columns are empty.
- `Logs.data` is a Java `toString()` dump to parse with regex. It contains the **InfoboardModule** with typed modules: `STOERUNGSBESCHRIEB` (description, often the public VIA text), `BETRIEBSKONZEPT_FERN/_REGIONAL` (cancelled/diverted trains), `MASSNAHMEN` (per train), `ERSATZVERKEHR` (replacement buses, stops), `REISEEMPFEHLUNG` (travel recommendation), **`KULANZMASNAHMEN` (commercial gestures / ticket validity via another route)**. 62 texts still contain `XXX` placeholders.
- Files have no timezone (assume Swiss local time) and a UTF-8 BOM.

### VIA event reports: key facts

- Each row = one (re)publication of an event. Only metadata: codes, places (operating point abbreviations like `MOR-STP`), lines (`IR15, IR57, ...`), timestamps.
- Useful timestamps: creation, first publication to travellers (median 15 min after creation), first travel recommendation (36/168 events), first replacement bus publication (31/168, median 41 min after first publication), global end.

---

## 3. opentransportdata.swiss and OJP 2.0 (basics)

opentransportdata.swiss is the official Swiss public transport open data platform (run by SBB for the Federal Office of Transport). It offers:

- **Static data** to download: timetables (GTFS, HRDF, NeTEx), **service points** (all stops with SLOID, number, name, coordinates).
- **Real-time data**: GTFS-RT, SIRI, and **"Ist-Daten"** (actual realised times, archived per day).
- **APIs**, the main one for us being **OJP 2.0 (Open Journey Planner)**.

**OJP 2.0**
- One endpoint, **XML over POST** (not JSON): `https://api.opentransportdata.swiss/ojp20`.
- Auth: create an account on the API Manager portal, create an application, subscribe to OJP 2.0, get a token, send `Authorization: Bearer <token>`. Key goes in `.env` as `OJP_API_KEY`, never in git. Quotas are limited: one key per person.
- Useful requests:
  - `LocationInformationRequest`: find stops by name or coordinates.
  - `TripRequest`: A → B itineraries with real-time delays, options (via, transfers, accessibility) and the **situations** (disruptions) affecting the trip.
  - `TripInfoRequest`: all stops of a given service (needed for "get off at an intermediate stop").
  - `StopEventRequest`: departures/arrivals board of a stop.
- Stops are identified by **SLOID** (`ch:1:sloid:7000` = Bern, `ch:1:sloid:3000` = Zürich HB), matching DiDok numbers `8507000` / `8503000`.
- The **OJP demo app** (`opentdatach.github.io/ojp-demo-app`) shows the XML requests/responses: fastest way to copy a working request. Open source on GitHub with a reusable JS library.
- Trafimage (`maps.trafimage.ch`) has punctuality layers per mode: nice for pitch visuals, not something to integrate.

Plan document (French): https://claude.ai/artifact/99L8MtmsyrWQPbrqcCLpoN

---

## 4. What the data really says about estimating disruption duration

For each public incident we rebuilt the **first announced end time** and the **real end** (switch to `ENDED` in the version history). On **510 incidents** (Mar 2024 – Oct 2026):

- Median real duration: **2 h 45** (half between 1 h 40 and 4 h 25).
- The first announced end time is **too optimistic in 68 % of cases**, by **30 min** median. It is revised in **71 %** of incidents.
- Duration depends strongly on the cause (median, 25–75 %): train blocking the line (EG_014) 1 h 30 (1 h – 2 h); infrastructure fault (EG_010) 2 h (1 h 15 – 3 h 30); person accident (EG_047) 2 h 55 (2 h 05 – 3 h 40); overhead line (EG_008) 5 h 35 (3 h – 9 h 45).

**The honest point.** A naive model trained on 2024–2025 and tested on 2026 (139 incidents): a per-cause median **does not beat** the official announcement (median error 75 min vs 60 min). Correcting the official time with a historical factor per cause gives 10–90 % ranges that contain the real end in 75 % of cases, but they are wide (~4 h), and "bad surprises" (end more than 30 min after the estimate) drop from 55 % to 45 %.

So: **don't sell "we predict better than SBB".** Sell "we translate the official announcement into honest probabilities":
*"SBB announces 15:00. Historically, for this kind of incident, it was over before 15:00 in 35 % of cases and before 16:00 in 70 %."*

Improvements, by return on effort:
1. **Condition on elapsed time** (survival logic): "it has lasted 1 h 30, how long is left?". That is exactly the stuck traveller's question.
2. Update the estimate on each new version of the announcement (~9 versions per incident).
3. Add interruption vs restriction, time of day, section. With 510 incidents, more than 2–3 variables makes groups too small.
4. Always show **calibration** (on 2026, when we say 70 %, is it true ~70 % of the time?). That makes it credible to the jury.

Caveat: `ENDED` in the ticker is a proxy for the real reopening (data entry can lag).

---

## 5. Our ideas, rated honestly (out of 5)

| Idea | Feasibility | Usefulness | Creativity | Verdict |
|---|---|---|---|---|
| "Need help" button → guided disruption mode | 4 | 5 | 3 | **Core of the product.** |
| See all alternatives at any time | 3 | 4 | 2 | Merge into the help mode. "All" drowns the user: show the best ones, ranked. |
| Questions to personalise | 5 | 4 | 3 | Keep, but few questions with defaults, only ones that change the recommendation. |
| Continuous push notifications | 3 | 4 | 1 | Exists in the SBB app. For the demo, **simulate** notifications in the UI. |
| Register a regular trip, notified only at the right time | 3 | 4 | 2 | Good UX, not very differentiating alone. Entry point of the demo. |
| **Estimate the undetermined delay (range + precision)** | 4 | 5 | 5 | **Our flagship idea.** Supported by the data (see section 4). |
| "Not ideal" alternative: get off at an intermediate stop | 4 | 4 | 4 | Very good. `TripInfoRequest` + `TripRequest` from each stop. With the estimate it gives the real decision: wait or leave. |
| Connections: probability the early delay is still there at the end | 2 (3 with Ist-Daten) | 4 | 4 | **Not possible with the given data** (no per-train delays). Bonus only, via Ist-Daten. OJP real-time already gives estimated arrival, so connection impact can be computed without a model. |
| Google Maps to predict bus delays | 2 | 2 | 2 | **Drop it.** Paid, terms forbid storing data, and bus real-time is already in OJP / GTFS-RT. |
| Internal SBB data: dose the information (short by default, details on demand) | 4 | 4 | 4 | Good pitch angle: internal knows ~3 min after the incident vs ~39 min public, with precise bus stops and travel recommendations. Show it on 1–2 Sept 2026 incidents. Not much help for probabilities (137 cases, one month). |

### Later additions from the team

| Addition | Feas. | Use | Creat. | Verdict |
|---|---|---|---|---|
| **Destination radius**: "I can arrive within x km of my destination" | 4 | 4 | 4 | Very good, generalises the intermediate-stop idea. Take stops within the radius (service points coordinates), keep the top 5–10, run a `TripRequest` to each, add the last leg (walk, bike, taxi), rank by final arrival. Limit stops to respect the OJP quota. |
| **Commuters: alert when an earlier train on the line is hit** | 4 | 5 | 4 | Excellent, differentiates our notifications from the SBB app. Combines with the estimate: *"The 7:02 is stuck at Puidoux. Chance it is still disrupted for your 7:32: 65 %."* Detection via OJP situations/delays on the line; for the demo, replay a real incident. |
| **Real-time road traffic** for buses | 3 | 3 (5 for replacement buses) | 3 | Regular buses: OJP already has real-time vehicle delay and rush hour is in the timetable. Useful mainly for **replacement buses** (no reliable timetable, no real-time). Compare duration with current traffic vs free flow. Use **TomTom or HERE** (free developer tiers, usually no card), not Google (billing account, storage forbidden). Limit: car time, not bus time. **First thing to cut** if short on time. |

---

## 6. UX decisions

Mockup (SBB colours, 3 screens: disruption mode, category list, Personalise): `docs/mode-perturbation-v1.png`.

Screen flow from the team's sketch:
1. Journey info with the estimate.
2. **Personalise** button (questions). Defaults: destination radius 10 km, no deadline, avoid replacement bus.
3. **3 alternative categories**, each showing its best option: **fastest arrival**, **within the destination radius**, **comfort**. Tapping one opens a page listing all of them ranked by that category.

**Rule: the official SBB number is never replaced.**
- Don't touch a train's delay ("+20 min" comes from the train's real position and is reliable). Our estimate is about something else: **when the interrupted line reopens**, which is often vague in the data ("at least until 18:00", "around 18:00").
- Show the SBB time big, and our range as a **margin**: *"Reopening expected: 18:00 (SBB). In similar disruptions, reopening took longer 2 times out of 3: plan a margin until 19:00."*
- Use the statistics **mainly to rank alternatives**, not to display a second number. If waiting is risky, recommend the detour with a simple reason: *"Reopening is uncertain, this route does not depend on the blocked line."*
- Pitch framing: integrated into the SBB app, this is SBB being honest that its forecast has a margin. Could even be a recommendation to SBB: announce a range instead of a precise time that slips several times (71 % of announcements are revised).
- In the v1 mockup, the crossed-out 18:21 next to "19:05 – 19:50" creates exactly this confusion: fix it.

**Improvement ideas for the mockup**
1. Put a **decision at the top**, not only info: *"Our advice: go via Neuchâtel, 19:12, safe."* Categories below.
2. Make **"Wait" a real option**, compared with the others with its range. This is where the estimate makes the difference.
3. Ask questions at the right moment: defaults first, change in one tap, remember answers for the saved trip.
4. Give each option a **certainty level** (safe / likely / uncertain) with one line of why, consistent with the estimate range.
5. Show **whether the ticket is valid** on the alternative.
6. Show **"updated 2 min ago"** and what changed when the estimate moves, otherwise a moving range looks like the app is wrong.
7. **Mini-map for the radius option** (destination, circle, arrival point). Explains the idea in one second during the pitch.
8. **Hide or grey out options that contradict the answers** (e.g. replacement bus while "avoid" is checked), with the reason.

---

## 7. Ticket validity during disruptions

From memory, **to verify on the SBB "passenger rights" page before the pitch**:
- A normal ticket is **not tied to a specific train**. During a disruption you can take **another route** to the same destination at no extra cost, replacement buses included.
- **Supersaver tickets** are tied to a train, but that restriction falls in case of delay or cancellation.
- **Compensation**: from about **60 min** arrival delay, part of the price is refunded (about 25 %, 50 % from 120 min). Different rules for travel passes.
- If the expected delay exceeds about 60 min, you can cancel the trip and get a refund, or return to the start. If the last connection is missed, the company must offer a solution (transport or accommodation).
- Taxi/Uber taken on your own initiative: in principle not covered.

For our app:
- **Radius option**: if the user arrives somewhere other than the destination, the last leg (city bus, other fare zone) **may not be covered**. Show "ticket valid" or "zone ticket needed".
- The internal data's `KULANZMASNAHMEN` module says what is accepted for each incident ("tickets valid via X"): ideal source for exact validity and a good argument for the value of internal data.

---

## 8. Demo scenario (realistic scope)

One mobile-first flow, shown on a **replayed real incident** (a live disruption during the demo is not guaranteed):
1. **My trips**: the user saved e.g. Lausanne → Bern, 17:15.
2. **Simulated notification**: "Interruption Puidoux – Palézieux, person accident." Button **Need help**.
3. **Personalise** (defaults pre-filled).
4. **Estimate**: "SBB: reopening around 18:00. From 75 similar cases: 40 % chance before 18:00, 80 % before 19:00." Clearly labelled as an estimate.
5. **Ranked options**: fastest, within radius, comfort, and wait, each with arrival time, certainty and ticket hint.
6. **"More details"**: cancelled trains, bus stops from internal data, to show information dosing.
7. Live update when the incident evolves (replayed from the version history).

---

## 9. The code skeleton (this repo)

See `README.md` for the full tree and how to run it.

- **Backend**: Python 3.10+, FastAPI (`backend/app/`). **Frontend**: React 18 + TypeScript + Vite (`frontend/`).
- Every endpoint currently returns **mock data** (search for `TODO` and `MOCK`), so the three parts can be built in parallel.
- **Shared contract**: `backend/app/models.py` and `frontend/src/types.ts`. Change them together, in the same commit.
- API stubs: `GET /journeys/{id}/status`, `POST /alternatives`, `POST/GET/DELETE /commuters/trips`, `GET /commuters/{user}/notifications`. Use journey id `demo-1`.
- `.env` (from `.env.example`) holds `OJP_API_KEY`, optional `TOMTOM_API_KEY` / `HERE_API_KEY`, `DATA_DIR`. `Daten/` and `.env` are git-ignored.

### Who owns what

| Workstream | Owner | Folders | First goals |
|---|---|---|---|
| **A. Data & estimation** | _TBD_ | `notebooks/`, `backend/app/estimation/`, `api/disruptions.py` | Rebuild incident timelines from `incident` + `incident_audit`; duration per cause, then conditioned on elapsed time; validate 2024–25 → 2026 with a calibration chart; plug into `estimate_reopening()`; prepare demo incidents (incl. KULT matching for internal details); probability "still disrupted at my train" for the earlier-train alert. |
| **B. Routing & OJP** | _TBD_ | `backend/app/routing/`, `api/alternatives.py` | API key; `TripRequest`, `TripInfoRequest`, `LocationInformationRequest` (copy XML from the demo app); service points radius search; intermediate stop logic; rank the categories using preferences + A's estimate; ticket hint; detection of disruptions on the line for the earlier-train alert; optional TomTom/HERE; caching. |
| **C. Frontend, UX & notifications** | _TBD_ | `frontend/`, `backend/app/notifications/`, `api/notifications.py` | Screens from the mockup (status, Personalise, categories, ranked list, my regular trip); showing uncertainty clearly; commuter trip registration and (simulated) push alerts incl. earlier train; demo script, slides, backup video. |

Recommended rhythm: first hour together to freeze the demo flow, pick 1–2 real incidents to replay, and agree on the JSON contract. Mid-way: an end-to-end flow working on fake data. Then plug in real data. Last 3–4 h: no new features, only demo and pitch. If ahead: connections with Ist-Daten.

---

## 10. Caching advice

Not implemented yet (the OJP client is still a stub). Recommended:
- **Static data** (service points, stops, planned timetables): cache for a long time, even on disk.
- **Real-time data** (delays, alternatives during a disruption): cache **30–60 s** only, otherwise the app may suggest a train that already left.
- **For the demo**: record a few OJP responses and replay them, so the demo depends neither on the network nor on the API quota.

---

## 11. Open questions

- Who owns which workstream (names still TBD in the README)?
- Which 1–2 real incidents do we replay for the demo? (Sept 2026 incidents exist in all three sources, e.g. Ardon – Sion 12.09, Zürich Stadelhofen – Stettbach 25.09, Puidoux – Vauderens 25.09, Renens – Morges 17.09.)
- Exact ticket validity rules: verify on the SBB site.
- Real push notifications or simulated in the UI? (Recommendation: simulated.)
- Road traffic (TomTom/HERE): keep or cut depending on time.
- Exact Personalise questions beyond the defaults (deadline, accessibility, luggage, max transfers?).
- How to present the estimate visually without contradicting the official SBB time (fix the v1 mockup).
