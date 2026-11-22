# Frontend

React 18 · TypeScript · Vite. An SBB-style phone app shown in a phone frame, with
a **presenter panel** next to it for the demo. It has no mock data: everything it
shows comes from the backend, which must run on http://localhost:8000.

```bash
npm --prefix frontend install
npm --prefix frontend run dev        # http://localhost:5173
npm --prefix frontend run build      # type-check + production build
```

Options (in `.env` at the repo root): `VITE_API_URL` (default
`http://localhost:8000`), `VITE_JOURNEY_ID` = `demo-zh` (default) or `demo-1`.
Add `?clean` to the URL to hide the presenter panel; `D` toggles it.

## Screens

| Screen | File | What it does |
|---|---|---|
| My trips | `screens/Home.tsx` | Today's disrupted journey ("What should I do?"), regular trips, booked trips, "Plan a trip" |
| Need help | `screens/DisruptionMode.tsx` | Three blocks: my train does not run (+ Details), **our advice** (one connection), Personalize / See all connections |
| Personalize | `screens/Personalize.tsx` | Three questions, one at a time, then back to Need help with "Best for you" |
| Details | `screens/IncidentDetails.tsx` | What, where, cause, since when; "When will trains run again?" (`components/HowLongCard.tsx`); **SBB messages** from the public liveticker; internal SBB details (KULT) when available |
| Connections | `screens/CategoryList.tsx` | All options in four lists: fastest, nearby, comfort, wait |
| Connection | `screens/ConnectionDetail.tsx` | Legs, changes, ticket hint, "Your ticket is valid · Save" |
| Regular trip / alert | `screens/CommuterSetup.tsx`, `screens/CommuterAlert.tsx` | Register a commuter trip; the alert opened from a notification |
| Booked trip / alert | `screens/BookingSetup.tsx`, `screens/BookingAlert.tsx` | Watch a trip paid in advance; its alert (connections at risk, bus forecast) |
| Plan a trip | `screens/PlanTrip.tsx` | Normal search ranked by reliability at that hour |
| Lock screen | `screens/LockScreen.tsx` | The notifications as on a phone |

`components/AdviceCard.tsx` is the advice card shared by Need help and the
alerts; `components/ui.tsx` holds the SBB-style building blocks (header,
connection card, timeline, reliability label with its %).

## Personalized advice (`lib/personalize.ts`)

Every option gets a cost in minutes; the cheapest one is "Best for you":

```
cost = minutes until arrival at the final stop
     + P_change × number of changes
     + P_bus    × (1 if the trip uses a replacement bus)
     + P_risk   × minutes of uncertainty
```

| Question 2 "What suits you best?" | P_change | P_bus | P_risk |
|---|---|---|---|
| I accept anything | 2 | 5 | 1 |
| Changes yes, buses no | 5 | 60 | 1 |
| I'd rather wait | 10 | 60 | 0.3 |
| The simplest way | 20 | 60 | 0.5 |

- **Question 1 "Where can you get off?"** decides which trips are allowed: right
  at the destination station, up to 2 km (walk), or up to 10 km (someone picks
  me up). The last bit is not added to the cost.
- **Question 3 "You're travelling with…"** only sets limits: no bus with a bike,
  step-free only with reduced mobility, at most 1 km on foot.
- **Uncertainty:** waiting for the reopening = our median estimate minus the
  end announced by SBB; replacement bus = 10 min; other trips = their usual
  road delay.

Without answers, `lib/ranking.ts` picks a default advice (most reliable, then
earliest). `lib/chance.ts` turns probabilities into words and colours
("Reliable · 95%").

## State and data flow

`store.tsx` loads the live situation, then the status, the details and the
alternatives, and recomputes them whenever the situation or the answers change.
Commuter and booked-trip alerts are polled every 5 s and shown as a banner, on
the lock screen, and as real OS notifications if allowed (`lib/osNotifications.ts`,
`public/sw.js`). `api/client.ts` is the only place that calls the backend;
`types.ts` mirrors `backend/app/models.py`.

## Presenter panel (`demo/DemoPanel.tsx`)

- **Time:** +5 / +15 / +30 min (and "Next SBB update" on the replayed incident).
- **SBB updates:** publish a new end time, start or stop replacement buses,
  "Line reopens now".
- **Published updates:** "Show app", "Open Need help", "Reset the demo" (also
  deletes the trips added during the demo).
- **Traffic jam on the bus route:** +8 / +15 min for the booked-trip checks.
- **Staged alerts: Coppet → Lausanne, 08:19** (`demo/coppetScenario.ts`):
  hand-written notifications for a morning commuter, after the real incident
  Gland – Nyon of 5 March 2025: line closed, end moved, replacement buses, line
  reopened. This trip is always in "My trips".
- **Commuter alerts:** "Show lock screen", "Also send real OS notifications".
