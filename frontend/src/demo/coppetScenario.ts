// Staged commuter alerts for the presenter (not computed by the backend).
// Commuter: Coppet -> Lausanne, RE33 at 08:19 every weekday morning (real
// timetable, OJP). The disruption follows a real incident of the public
// liveticker: "Gland - Nyon", Wednesday 5 March 2025, external cause, from
// 08:04; SBB announced 09:00, then 09:40, 10:40, 11:15; replacement buses
// from 09:26; service resumed at 11:04.
import type { Alternative, CommuterAlert, CommuterTrip, Leg, LineTrain, NotificationKind, Stop } from "../types";
import { atTime } from "../lib/format";

const COPPET: Stop = { id: "8501023", name: "Coppet" };
const NYON: Stop = { id: "8501030", name: "Nyon" };
const GLAND: Stop = { id: "8501031", name: "Gland" };
const LAUSANNE: Stop = { id: "8501120", name: "Lausanne" };

export const DEMO_TRIP: CommuterTrip = {
  id: "demo-coppet-lausanne", user_id: "demo-user",
  origin_stop_id: COPPET.id, destination_stop_id: LAUSANNE.id,
  origin_name: COPPET.name, destination_name: LAUSANNE.name,
  departure_time: "08:19", arrival_time: "08:59", line: "RE33", weekdays: [0, 1, 2, 3, 4],
};

export interface DemoStep { id: string; button: string; build: (day: string) => CommuterAlert }

function leg(day: string, mode: string, line: string | null, from: Stop, to: Stop, dep: string, arr: string): Leg {
  return { mode, line, from_stop: from, to_stop: to, departure: atTime(day, dep), arrival: atTime(day, arr), road_delay_minutes: null };
}

function option(id: string, title: string, legs: Leg[], extra: Partial<Alternative>): Alternative {
  const rides = legs.filter((l) => l.mode !== "walk");
  return {
    id, category: "fastest", legs, arrival: legs[legs.length - 1].arrival, final_stop: LAUSANNE,
    distance_to_destination_km: 0, transfers: Math.max(0, rides.length - 1), score: 100,
    ticket_valid: true, ticket_hint: null, title, departure: legs[0].departure, ...extra,
  };
}

const waitFor = (day: string, dep: string, arr: string) => option("wait", "Wait for the line to reopen",
  [leg(day, "train", "RE33", COPPET, LAUSANNE, dep, arr)],
  { certainty: "uncertain", certainty_reason: "Depends on when the line reopens", uses_blocked_line: true });

function alert(day: string, step: string, at: string, kind: NotificationKind, title: string, body: string,
  headline: string, reasons: string[], line: LineTrain[], options: Alternative[], probability: number | null): CommuterAlert {
  return {
    notification: {
      id: `demo-coppet-${step}`, trip_id: DEMO_TRIP.id!, incident_id: "demo-gland-nyon",
      created_at: atTime(day, at), title, body, kind, probability,
    },
    trip: DEMO_TRIP,
    planned_departure: atTime(day, "08:19"), planned_arrival: atTime(day, "08:59"),
    headline, reasons, line, options,
  };
}

const train = (day: string, hm: string, state: LineTrain["state"], note: string, yours = false): LineTrain =>
  ({ departure: atTime(day, hm), line: "RE33", state, note, yours });

const SOURCE = "Based on a real incident: Gland – Nyon, 5 March 2025 (SBB liveticker)";

export const COPPET_STEPS: DemoStep[] = [
  {
    id: "closed", button: "08:10 · Line closed",
    build: (day) => alert(day, "closed", "08:10", "own_train",
      "Your 08:19 to Lausanne will probably not run",
      "No trains between Nyon and Gland since 08:04 (external event). SBB expects trains again around 09:00, "
      + "but similar incidents usually last longer. No other train goes to Lausanne: don't go to the station yet.",
      "Your 08:19 RE33 will probably not run",
      ["Your RE33 runs through Nyon – Gland, closed since 08:04",
        "SBB announces 09:00; after similar incidents the line reopened around 09:40",
        SOURCE],
      [train(day, "07:49", "ok", "Got through before the closure"),
        train(day, "08:19", "cancelled", "Ends at Nyon", true),
        train(day, "08:49", "at_risk", "Only if the line reopens in time")],
      [waitFor(day, "09:19", "09:59")], 0.9),
  },
  {
    id: "later", button: "09:11 · SBB moves the end to 09:40",
    build: (day) => alert(day, "later", "09:11", "own_train",
      "Still no trains between Nyon and Gland",
      "SBB now expects trains around 09:40 (it said 09:00), as we expected. "
      + "Next realistic train: RE33 at 09:49, in Lausanne at 10:29 if the line reopens on time.",
      "SBB moved the reopening to 09:40",
      ["SBB moved the expected end from 09:00 to 09:40", "Your 08:19 and the 08:49 do not run", SOURCE],
      [train(day, "08:19", "cancelled", "Ended at Nyon", true),
        train(day, "08:49", "cancelled", "Ends at Nyon"),
        train(day, "09:19", "at_risk", "Only if the line reopens in time")],
      [waitFor(day, "09:49", "10:29")], 0.8),
  },
  {
    id: "buses", button: "09:26 · Replacement buses",
    build: (day) => alert(day, "buses", "09:26", "own_train",
      "Replacement buses between Nyon and Gland",
      "Take the RE33 at 09:49 to Nyon, the bus to Gland, then the RE33 at 10:29: in Lausanne at 10:59. "
      + "Safer than waiting: SBB has already moved the end once.",
      "Replacement buses now run between Nyon and Gland",
      ["SBB runs replacement buses between Nyon and Gland since 09:26",
        "SBB expects trains around 09:40, but has already moved the end once", SOURCE],
      [train(day, "09:19", "cancelled", "Ends at Nyon"),
        train(day, "09:49", "at_risk", "Ends at Nyon unless the line reopens")],
      [option("bus", "Replacement bus Nyon – Gland", [
        leg(day, "train", "RE33", COPPET, NYON, "09:49", "09:54"),
        leg(day, "replacement_bus", "EV", NYON, GLAND, "10:00", "10:20"),
        leg(day, "train", "RE33", GLAND, LAUSANNE, "10:29", "10:59"),
      ], { certainty: "likely", certainty_reason: "Replacement buses can be slowed by traffic" }),
      waitFor(day, "09:49", "10:29")], 0.8),
  },
  {
    id: "reopened", button: "11:04 · Line reopened",
    build: (day) => alert(day, "reopened", "11:04", "resolved",
      "Line reopened: Nyon - Gland",
      "Trains run again since 11:04. Delays and some cancellations are still possible. "
      + "Next RE33 from Coppet at 11:19, in Lausanne at 11:59.",
      "Trains run again between Nyon and Gland",
      ["SBB reports that service has resumed at 11:04", SOURCE],
      [train(day, "11:19", "ok", "Runs, small delays possible")],
      [], null),
  },
];
