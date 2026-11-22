# Guide: run and use SBB Disruption Helper

A step-by-step guide to install the app, run the demo and try every feature.
For what the project is and why, see [`README.md`](README.md).

## 1. Install (once)

You need **Python 3.10+**, **Node.js 18+** and the SBB data folder `Daten/`
(provided for the hackathon, not in git).

1. Put `Daten/` at the root of the repository, with the layout you received
   (`Daten/extern-liveticker/`, `Daten/intern-liveticker/`, `Daten/Ereignismeldungen/`).
2. From the repository root:

```bash
python3 -m venv backend/.venv
```

```bash
backend/.venv/bin/pip install -r backend/requirements.txt
```

```bash
npm --prefix frontend install
```

3. Optional: copy the settings file and add API keys. Without keys the demo
   still runs offline (see step 2).

```bash
cp .env.example .env
```

| Setting | Needed for |
|---|---|
| `OJP_API_KEY` | Live timetable searches (opentransportdata.swiss). Not needed in `replay` mode |
| `TOMTOM_API_KEY` | Live road traffic for replacement buses and bus delays. Without it, times are estimated |

## 2. Start

Open two terminals at the repository root.

**Backend** (http://localhost:8000, API docs at http://localhost:8000/docs):

```bash
OJP_MODE=replay backend/.venv/bin/uvicorn app.main:app --app-dir backend --reload
```

**Frontend** (http://localhost:5173):

```bash
npm --prefix frontend run dev
```

Open **http://localhost:5173** in Chrome, Edge or Safari. The app runs in a phone
frame; the **presenter panel** is on the right (press `D` to hide or show it).

`OJP_MODE` chooses where timetables come from:

| Mode | When to use it |
|---|---|
| `replay` | Offline demo, no key: recorded OJP answers only (recommended for the pitch) |
| `auto` | With a key: recorded answers, and OJP for anything new (recorded too) |
| `live` | With a key: always ask OJP |

To show the **replayed real incident** (Lausanne → Bern) instead of the default
journey, start the frontend with:

```bash
VITE_JOURNEY_ID=demo-1 npm --prefix frontend run dev
```

## 3. Use the app

### My trips

The home screen. Today's journey **Zürich HB → Hinwil, S14 at 17:42** shows
"Your train does not run". Below: your regular trips (Coppet → Lausanne is
always there), your booked trips, and "Plan a trip".

### Need help

Tap **What should I do?**

1. **Your journey:** the train that does not run, and a **Details** button.
2. **Our advice:** one connection, with a reliability label and its chance
   (e.g. "Reliable · 99%") and why we picked it. Tap it to see the legs and
   whether your ticket is valid.
3. **Personalize my trip** and **See all connections** (fastest, nearby,
   comfort, wait).

### Personalize

Three questions, one tap each. Back on "Need help", the card becomes
**Best for you**, with the reasons.

| Question | Answers |
|---|---|
| Where can you get off? | Right at my destination · Close by, I'll walk the rest (2 km) · Further away, someone picks me up (10 km) |
| What suits you best? | I accept anything · Changes yes, buses no · I'd rather wait · The simplest way |
| You're travelling with… | Nothing special · Luggage / stroller · A bike · Reduced mobility |

### Details

Where, what, cause and since when; **When will trains run again?** (SBB's time,
our most likely range, and chances in words); the **SBB messages** published so
far; and, for the replayed incident, SBB's internal information (replacement
buses, cancelled trains, ticket goodwill).

### Regular trip alerts

**Add a regular trip** (stations, usual departure, days) and **Save and turn on
alerts**. From 3 h before your usual train, any interruption on its line sends
a notification: whether your train will run, and what to take instead. Tap
**Allow** next to "Phone notifications" to also get real browser notifications.

### Booked trips

**Add a booked trip** (a ticket bought in advance, e.g. Supersaver) and
**Watch this trip**. From 3 h before departure the app checks the connections,
the incidents and the bus delays, and warns you if a change is at risk.

### Plan a trip

A normal search, ranked by reliability at that hour: at rush hour a slightly
longer train can beat a bus that is often stuck in traffic.

## 4. Run the demo (presenter panel)

Start with **Reset the demo**: clock at 17:32, SBB expects trains again around
18:42, no replacement buses, and the trips added during the last demo are gone.

### Scenario 1: Zürich HB → Hinwil, evening commute

| Step | In the panel / app | What you see |
|---|---|---|
| 1 | **Open "Need help"** | Our advice: S3 via Wetzikon ZH, 18:04 → 18:52 |
| 2 | **Personalize**: Right at my destination · I accept anything · Nothing special | Best for you: still the S3 via Wetzikon (waiting would mean 19:22) |
| 3 | Type **18:00** in "SBB expects trains again at", **Publish** | Best for you becomes: wait for your 17:42 S14, arriving 18:22 |
| 4 | **Personalize** again: Further away, someone picks me up · I accept anything · Nothing special | Best for you: get off earlier (Bubikon 18:39 or Wetzikon 18:41) and be picked up |
| 5 | Tick **Replacement buses running** | The bus appears in "See all connections" and in the SBB messages of **Details** |
| 6 | **+5 / +15 / +30 min** | Time moves on; new SBB messages appear in Details |
| 7 | **Line reopens now** | "Running again" |

Keep the clock before 17:42 while you show "wait for your 17:42".

### Scenario 2: commuter notification on the Zürich trip

1. **Reset the demo**, then in the app **Add a regular trip** (pre-filled:
   Zürich HB → Hinwil, 17:42, Monday–Friday) → **Save and turn on alerts**.
2. Within 5 s a banner appears: "Your 17:42 will probably not run", with the
   connection to take. **Show lock screen** shows it on the lock screen.
3. Publish **18:00**: "Your 17:42 to Hinwil may be affected". **Line reopens now**: "Line reopened".

### Scenario 3: Coppet → Lausanne, morning commute

In **Staged alerts: Coppet → Lausanne, 08:19**, press the buttons in order. Each
one shows a notification (banner, lock screen, OS notification if ticked); tap it
to open the alert with our advice.

| Button | Notification |
|---|---|
| 08:10 · Line closed | Your 08:19 to Lausanne will probably not run; don't go to the station yet |
| 09:11 · SBB moves the end to 09:40 | Still no trains between Nyon and Gland; next realistic train 09:49 |
| 09:26 · Replacement buses | RE33 to Nyon, bus to Gland, RE33 to Lausanne, arriving 10:59 |
| 11:04 · Line reopened | Trains run again; next RE33 at 11:19 |

### Scenario 4: the real incident, replayed (`demo-1`)

Start the frontend with `VITE_JOURNEY_ID=demo-1`. Lausanne → Bern, fire
Puidoux – Vauderens of 25.09.2026. **Next SBB update** jumps to the next real
announcement; the estimate, the SBB messages and the internal details follow the
real data.

## 5. Tests

```bash
backend/.venv/bin/python -m pytest backend/tests
```

```bash
npm --prefix frontend run build
```

## Troubleshooting

| Problem | Fix |
|---|---|
| "The server is not reachable" in the app | Start the backend; the app retries every 3 s |
| Timetable unavailable (503) | Use `OJP_MODE=replay`, or add `OJP_API_KEY` and use `auto` |
| No commuter alert | The usual departure must be within 3 h of the demo clock, on a selected weekday; in `replay` only the Zürich → Hinwil trip is recorded |
| Changed the backend code but nothing changes | Restart it (or keep `--reload`) |
| Old trips still listed | **Reset the demo** removes the trips added during the demo |
