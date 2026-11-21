// Demo scenarios, replayed step by step from the presenter panel.
//
// A. Delay mode: real incident 2195005195853 from the public liveticker,
//    25.09.2026 "Interrupted service: Puidoux - Vauderens and Lucens" (fire,
//    EG_110). SBB announced ~18:00, moved it to ~18:45 at 17:46, service
//    resumed at 18:15. Timeline and SBB times are real.
//    PLACEHOLDER (to replace with real values): probabilities, similar-incident
//    counts (workstream A), the alternatives and their times (workstream B, OJP),
//    the internal details (KULT ticker / VIA).
// B. Commuter alerts: illustrative morning scenario on the same line.
//    All numbers are PLACEHOLDERS until workstream A provides the
//    "still disrupted at my train" probability.

import type {
  Alternative, AlternativeCategory, AlternativesResponse, Certainty, CommuterTrip,
  DisruptionStatus, IncidentDetails, Journey, Leg, LegMode, Notification, Stop,
} from "../types";
import { addMinutes, atTime } from "../lib/format";

// ---------------------------------------------------------------------------
// Stops (ids = DiDok numbers, coordinates approximate)
// ---------------------------------------------------------------------------
const S = {
  lausanne: { id: "8501120", name: "Lausanne", lat: 46.5168, lon: 6.6291 },
  bern: { id: "8507000", name: "Bern", lat: 46.949, lon: 7.4391 },
  neuchatel: { id: "8504221", name: "Neuchâtel", lat: 46.9967, lon: 6.9357 },
  yverdon: { id: "8504200", name: "Yverdon-les-Bains", lat: 46.7818, lon: 6.6407 },
  payerne: { id: "8504136", name: "Payerne", lat: 46.8196, lon: 6.9403 },
  fribourg: { id: "8504100", name: "Fribourg/Freiburg", lat: 46.8032, lon: 7.1513 },
  puidoux: { id: "8501209", name: "Puidoux", lat: 46.5003, lon: 6.7612 },
  vauderens: { id: "8504039", name: "Vauderens", lat: 46.6231, lon: 6.8481 },
  brunnen: { id: "8507051", name: "Bern Brünnen Westside", lat: 46.9437, lon: 7.3753 },
  bumpliz: { id: "8507002", name: "Bern Bümpliz Nord", lat: 46.9478, lon: 7.3922 },
  kerzers: { id: "8504488", name: "Kerzers", lat: 46.9752, lon: 7.1953 },
} satisfies Record<string, Stop>;

export const STOP_OPTIONS: Stop[] = [S.lausanne, S.bern, S.fribourg, S.neuchatel, S.yverdon, S.payerne];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
export const DELAY_DAY = "2026-09-25";
const t = (hm: string) => atTime(DELAY_DAY, hm);

function leg(mode: LegMode, line: string | null, from: Stop, to: Stop, dep: string, arr: string, roadDelay: number | null = null): Leg {
  return { mode, line, from_stop: from, to_stop: to, departure: t(dep), arrival: t(arr), road_delay_minutes: roadDelay };
}

type AltInput = Omit<Alternative, "arrival" | "departure" | "transfers" | "score" | "final_stop" | "distance_to_destination_km"> &
  Partial<Pick<Alternative, "final_stop" | "distance_to_destination_km">>;

function alt(a: AltInput): Alternative {
  const moving = a.legs.filter((l) => l.mode !== "walk" && l.mode !== "wait");
  return {
    final_stop: a.legs[a.legs.length - 1].to_stop,
    distance_to_destination_km: 0,
    ...a,
    departure: a.legs[0].departure,
    arrival: a.legs[a.legs.length - 1].arrival,
    transfers: Math.max(0, moving.length - 1),
    score: 0,
  };
}

/** Same alternative, later departure (for the later replay steps). */
function shifted(a: Alternative, minutes: number, suffix: string, patch: Partial<Alternative> = {}): Alternative {
  return {
    ...a,
    id: `${a.id}-${suffix}`,
    legs: a.legs.map((l) => ({ ...l, departure: addMinutes(l.departure, minutes), arrival: addMinutes(l.arrival, minutes) })),
    departure: a.departure && addMinutes(a.departure, minutes),
    arrival: addMinutes(a.arrival, minutes),
    arrival_latest: a.arrival_latest ? addMinutes(a.arrival_latest, minutes) : a.arrival_latest,
    ...patch,
  };
}

function as(a: Alternative, category: AlternativeCategory, patch: Partial<Alternative> = {}): Alternative {
  return { ...a, id: `${a.id}-${category}`, category, ...patch };
}

const TICKET_OK = "Ticket valid on this route (SBB rule for this disruption)";

// ---------------------------------------------------------------------------
// A. Delay mode: Lausanne -> Bern, IC 1 at 17:20
// ---------------------------------------------------------------------------
export const DELAY_JOURNEY: Journey = {
  id: "demo-1",
  origin: S.lausanne,
  destination: S.bern,
  departure: t("17:20"),
  arrival: t("18:26"),
  line: "IC 1",
};

const INCIDENT_ID = "2195005195853";
const TITLE = "Interruption Puidoux – Vauderens";
const REASON = "Fire near the track";
const SECTION = "Puidoux – Vauderens and Lucens";

// --- Alternatives, version 1 (clock 16:52) ---
const viaNeuchatel = alt({
  id: "neuchatel", category: "fastest",
  title: "Go via Neuchâtel", subtitle: "IC 5, change in Neuchâtel",
  legs: [
    leg("train", "IC 5", S.lausanne, S.neuchatel, "17:15", "17:55"),
    leg("train", "RE", S.neuchatel, S.bern, "18:04", "18:40"),
  ],
  certainty: "safe", certainty_reason: "Avoids the closed line",
  ticket_valid: true, ticket_hint: TICKET_OK, accessible: true,
});

const viaPayerne = alt({
  id: "payerne", category: "fastest",
  title: "Go via Yverdon and Payerne", subtitle: "3 changes",
  legs: [
    leg("train", "IC 5", S.lausanne, S.yverdon, "17:15", "17:37"),
    leg("train", "S 30", S.yverdon, S.payerne, "17:50", "18:23"),
    leg("train", "RE", S.payerne, S.fribourg, "18:30", "18:52"),
    leg("train", "IC 1", S.fribourg, S.bern, "19:04", "19:26"),
  ],
  certainty: "safe", certainty_reason: "Avoids the closed line",
  ticket_valid: true, ticket_hint: TICKET_OK, accessible: true,
});

const replacementBus = alt({
  id: "bus", category: "fastest",
  title: "Take the replacement bus", subtitle: "Bus between Puidoux and Vauderens",
  legs: [
    leg("train", "S 4", S.lausanne, S.puidoux, "17:24", "17:39"),
    leg("replacement_bus", "EV", S.puidoux, S.vauderens, "17:45", "18:25", 10),
    leg("train", "RE", S.vauderens, S.fribourg, "18:32", "18:48"),
    leg("train", "IC 1", S.fribourg, S.bern, "18:56", "19:18"),
  ],
  certainty: "uncertain", certainty_reason: "Bus times depend on road traffic",
  warnings: ["Bus: +5 to +15 min (traffic)"],
  ticket_valid: true, ticket_hint: TICKET_OK, accessible: false,
});

const toBrunnen = alt({
  id: "brunnen", category: "nearby",
  title: "Get off at Bern Brünnen Westside", subtitle: "5 km from Bern station",
  legs: [
    leg("train", "IC 5", S.lausanne, S.neuchatel, "17:15", "17:55"),
    leg("train", "S 5", S.neuchatel, S.brunnen, "18:00", "18:27"),
  ],
  distance_to_destination_km: 5.2,
  certainty: "likely", certainty_reason: "Only 5 min to change in Neuchâtel",
  ticket_valid: true, ticket_hint: "Valid, Bern city zone included", accessible: true,
});

const toBumpliz = alt({
  id: "bumpliz", category: "nearby",
  title: "Get off at Bern Bümpliz Nord", subtitle: "4 km from Bern station",
  legs: [
    leg("train", "IC 5", S.lausanne, S.neuchatel, "17:15", "17:55"),
    leg("train", "S 5", S.neuchatel, S.bumpliz, "18:00", "18:30"),
  ],
  distance_to_destination_km: 3.9,
  certainty: "likely", certainty_reason: "Only 5 min to change in Neuchâtel",
  ticket_valid: true, ticket_hint: "Valid, Bern city zone included", accessible: true,
});

const toKerzers = alt({
  id: "kerzers", category: "nearby",
  title: "Get off at Kerzers", subtitle: "18 km from Bern station",
  legs: [
    leg("train", "IC 5", S.lausanne, S.neuchatel, "17:15", "17:55"),
    leg("train", "S 5", S.neuchatel, S.kerzers, "18:00", "18:12"),
  ],
  distance_to_destination_km: 18,
  certainty: "safe", certainty_reason: "Avoids the closed line",
  ticket_valid: false, ticket_hint: "Last leg to Bern not included", accessible: true,
});

const waitDirect = alt({
  id: "wait", category: "wait",
  title: "Wait for your direct train", subtitle: "Only works if the line reopens in time",
  legs: [
    leg("wait", null, S.lausanne, S.lausanne, "16:52", "18:20"),
    leg("train", "IC 1", S.lausanne, S.bern, "18:20", "19:26"),
  ],
  arrival_latest: t("20:26"),
  certainty: "uncertain", certainty_reason: "Depends on when the line reopens",
  ticket_valid: true, ticket_hint: "Your original ticket", accessible: true, uses_blocked_line: true,
  warnings: ["Seats likely"],
});

function response(by: Record<AlternativeCategory, Alternative[]>): AlternativesResponse {
  return { journey_id: DELAY_JOURNEY.id, by_category: by };
}

const altsV1 = response({
  fastest: [viaNeuchatel, replacementBus, viaPayerne],
  nearby: [toBrunnen, toBumpliz, toKerzers],
  comfort: [as(waitDirect, "comfort"), as(viaNeuchatel, "comfort")],
  wait: [waitDirect],
});

// --- Alternatives, version 3 (clock 17:46, SBB moves reopening to ~18:45) ---
const waitV3 = shifted(waitDirect, 30, "v3", {
  legs: [
    leg("wait", null, S.lausanne, S.lausanne, "17:46", "18:50"),
    leg("train", "IC 1", S.lausanne, S.bern, "18:50", "19:56"),
  ],
  departure: t("17:46"), arrival: t("19:56"), arrival_latest: t("20:26"),
  certainty_reason: "Depends on when the line reopens",
});
const altsV3 = response({
  fastest: [shifted(viaNeuchatel, 60, "v3"), shifted(replacementBus, 60, "v3"), shifted(viaPayerne, 60, "v3")],
  nearby: [shifted(toBrunnen, 60, "v3"), shifted(toBumpliz, 60, "v3"), shifted(toKerzers, 60, "v3")],
  comfort: [as(waitV3, "comfort"), as(shifted(viaNeuchatel, 60, "v3"), "comfort")],
  wait: [waitV3],
});

// --- Alternatives, version 4 (clock 18:15, service resumed) ---
const directNow = alt({
  id: "direct", category: "fastest",
  title: "Take your direct IC 1", subtitle: "Running again, about 5 min late",
  legs: [leg("train", "IC 1", S.lausanne, S.bern, "18:25", "19:31")],
  certainty: "safe", certainty_reason: "The line is open again",
  ticket_valid: true, ticket_hint: "Your original ticket", accessible: true,
  warnings: ["About +5 min"],
});
const altsV4 = response({
  fastest: [directNow, shifted(viaNeuchatel, 90, "v4")],
  nearby: [shifted(toBrunnen, 90, "v4"), shifted(toBumpliz, 90, "v4")],
  comfort: [as(directNow, "comfort")],
  wait: [as(directNow, "wait")],
});

// --- Internal details (KULT ticker) ---
const detailsV1: IncidentDetails = {
  source: "SBB operations (internal ticker)",
  summary: "Fire near the track between Puidoux and Vauderens. Fire brigade on site. Lines Lausanne – Fribourg and Lausanne – Payerne are interrupted.",
  cancelled_trains: [
    "IC 1 17:20 Lausanne → Bern: cancelled between Lausanne and Fribourg",
    "IR 15 17:24 Lausanne → Luzern: starts in Fribourg",
    "S 4 / S 5: cancelled between Puidoux and Palézieux",
  ],
  replacement_bus: [],
  recommendation: "To Bern: travel via Neuchâtel. To Fribourg: travel via Yverdon – Payerne.",
  ticket_rules: "Tickets are valid via Neuchâtel and via Yverdon – Payerne at no extra cost.",
};
const detailsV2: IncidentDetails = {
  ...detailsV1,
  replacement_bus: [
    "Puidoux → Palézieux → Oron → Vauderens, about every 20 min",
    "Stops: station forecourt in Puidoux and Palézieux, bus stop “Gare” in Vauderens",
    "Not step-free. Limited room for luggage and bikes.",
  ],
};

// --- Status per version ---
function status(p: Partial<DisruptionStatus> & Pick<DisruptionStatus, "estimate" | "last_update">): DisruptionStatus {
  return {
    incident_id: INCIDENT_ID, journey_id: DELAY_JOURNEY.id, title: TITLE, reason: REASON,
    affected_section: SECTION, kind: "interruption", started_at: t("16:31"),
    journey: DELAY_JOURNEY, changes: [], details: detailsV1, ...p,
  };
}

const estimateV1 = {
  official_end: t("18:00"), official_label: "around",
  likely_end_earliest: t("17:40"), likely_end_latest: t("19:00"),
  confidence: 0.8, similar_incidents_count: 23,
  explanation: "Based on 23 similar incidents (fire near the track, 2024–2026)",
  probabilities: [
    { before: t("17:30"), p: 0.15 },
    { before: t("18:00"), p: 0.4 },
    { before: t("18:30"), p: 0.62 },
    { before: t("19:00"), p: 0.8 },
    { before: t("20:00"), p: 0.92 },
  ],
  margin_until: t("19:00"), reliability: "fair" as const,
};

export interface DelayStep {
  /** Shown in the presenter panel */
  label: string;
  clock: string;
  status: DisruptionStatus;
  alternatives: AlternativesResponse;
  /** In-app toast when the presenter moves to this step */
  toast?: string;
}

export const DELAY_STEPS: DelayStep[] = [
  {
    label: "16:52 · Interruption, SBB: ~18:00",
    clock: t("16:52"),
    status: status({ estimate: estimateV1, last_update: t("16:37") }),
    alternatives: altsV1,
  },
  {
    label: "17:12 · Replacement buses running",
    clock: t("17:12"),
    status: status({
      estimate: estimateV1, last_update: t("17:10"), details: detailsV2,
      changes: ["Replacement buses now run between Puidoux and Vauderens"],
    }),
    alternatives: altsV1,
    toast: "Update: replacement buses now running",
  },
  {
    label: "17:46 · SBB moves reopening to ~18:45",
    clock: t("17:46"),
    status: status({
      last_update: t("17:46"), details: detailsV2,
      changes: ["SBB moved the expected reopening from ~18:00 to ~18:45", "Your options were re-ranked"],
      estimate: {
        official_end: t("18:45"), official_label: "around",
        likely_end_earliest: t("18:15"), likely_end_latest: t("19:30"),
        confidence: 0.85, similar_incidents_count: 23,
        explanation: "Based on 23 similar incidents (fire near the track, 2024–2026), already 1 h 15 long",
        probabilities: [
          { before: t("18:15"), p: 0.3 },
          { before: t("18:45"), p: 0.55 },
          { before: t("19:30"), p: 0.85 },
          { before: t("20:30"), p: 0.95 },
        ],
        margin_until: t("19:30"), reliability: "fair",
      },
    }),
    alternatives: altsV3,
    toast: "SBB update: reopening moved to ~18:45",
  },
  {
    label: "18:15 · Service resumed",
    clock: t("18:15"),
    status: status({
      title: "Service resumed: Puidoux – Vauderens", kind: "resolved",
      last_update: t("18:15"), details: detailsV2,
      changes: ["The line reopened at 18:15, 30 min earlier than announced"],
      estimate: {
        official_end: t("18:15"), official_label: "reopened at",
        likely_end_earliest: null, likely_end_latest: null, confidence: null,
        similar_incidents_count: 23, explanation: "Some delays and cancellations are still possible.",
        probabilities: [], margin_until: null, reliability: null,
      },
    }),
    alternatives: altsV4,
    toast: "Good news: the line has reopened",
  },
];

// ---------------------------------------------------------------------------
// B. Commuter alerts: Lausanne -> Fribourg, IR 15 at 07:32, weekdays
// ---------------------------------------------------------------------------
export const COMMUTER_DAY = "2026-09-28";
const c = (hm: string) => atTime(COMMUTER_DAY, hm);

export const COMMUTER_TRIP: CommuterTrip = {
  id: "trip-1", user_id: "demo-user",
  origin_stop_id: S.lausanne.id, destination_stop_id: S.fribourg.id,
  origin_name: S.lausanne.name, destination_name: S.fribourg.name,
  departure_time: "07:32", arrival_time: "08:19", line: "IR 15",
  weekdays: [0, 1, 2, 3, 4],
};

export interface LineTrain {
  time: string;
  train: string;
  state: "stuck" | "cancelled" | "at_risk" | "ok";
  note: string;
  yours?: boolean;
}

export interface CommuterOption {
  title: string;
  detail: string;
  departure: string;
  arrival: string;
  certainty: Certainty;
  reason: string;
  recommended?: boolean;
}

export interface CommuterAlert {
  notification: Notification;
  clock: string;
  headline: string;
  reasons: string[];
  line: LineTrain[];
  options: CommuterOption[];
  footer?: string;
}

const viaPayerneMorning = (dep: string, arr: string, recommended = true): CommuterOption => ({
  title: "Leave at 07:20 via Yverdon and Payerne",
  detail: "2 changes, avoids the closed line",
  departure: c(dep), arrival: c(arr),
  certainty: "safe", reason: "Avoids the closed line", recommended,
});

export const COMMUTER_ALERTS: CommuterAlert[] = [
  {
    clock: c("07:04"),
    headline: "Your train may be affected",
    notification: {
      id: "n1", kind: "earlier_train", probability: 0.65, trip_id: "trip-1", incident_id: null,
      created_at: c("07:04"),
      title: "Your 07:32 to Fribourg may be affected",
      body: "A train ahead of yours is stuck near Puidoux. To be safe, leave at 07:20 via Yverdon and Payerne.",
    },
    reasons: [
      "The 07:02 IR 15 has been stopped near Puidoux since 06:58 (technical fault on the track).",
      "In similar technical faults, the line was still closed 30 minutes later about 6 times out of 10.",
      "SBB has not announced an end time yet.",
    ],
    line: [
      { time: c("07:02"), train: "IR 15", state: "stuck", note: "Near Puidoux since 06:58" },
      { time: c("07:17"), train: "S 4", state: "at_risk", note: "Waiting in Lausanne" },
      { time: c("07:32"), train: "IR 15", state: "at_risk", note: "Probably affected", yours: true },
    ],
    options: [
      viaPayerneMorning("07:20", "08:41"),
      {
        title: "Wait for your 07:32", detail: "Only if the line reopens in time",
        departure: c("07:32"), arrival: c("08:19"),
        certainty: "uncertain", reason: "Depends on when the line reopens",
      },
    ],
  },
  {
    clock: c("07:16"),
    headline: "Your train will probably not run",
    notification: {
      id: "n2", kind: "own_train", probability: 0.85, trip_id: "trip-1", incident_id: null,
      created_at: c("07:16"),
      title: "Your 07:32 will probably not run",
      body: "The line is closed until about 08:00. Take the 07:20 via Yverdon and Payerne, arriving 08:41.",
    },
    reasons: [
      "SBB now announces the line Puidoux – Palézieux closed until about 08:00.",
      "The 07:17 S 4 has been cancelled.",
      "When SBB says “around 08:00” for this kind of fault, the line usually reopens later (7 times out of 10).",
    ],
    line: [
      { time: c("07:02"), train: "IR 15", state: "stuck", note: "Still near Puidoux" },
      { time: c("07:17"), train: "S 4", state: "cancelled", note: "" },
      { time: c("07:32"), train: "IR 15", state: "at_risk", note: "Probably cancelled or very late", yours: true },
      { time: c("08:02"), train: "IR 15", state: "at_risk", note: "May run if the line reopens" },
    ],
    options: [
      viaPayerneMorning("07:20", "08:41"),
      {
        title: "Take the 08:02 instead", detail: "Only if the line reopens by then",
        departure: c("08:02"), arrival: c("08:49"),
        certainty: "uncertain", reason: "Depends on when the line reopens",
      },
    ],
  },
  {
    clock: c("08:05"),
    headline: "Trains are running again",
    notification: {
      id: "n3", kind: "resolved", probability: null, trip_id: "trip-1", incident_id: null,
      created_at: c("08:05"),
      title: "Line reopened: Lausanne – Fribourg",
      body: "Trains are running again, a few minutes late. Tomorrow's 07:32 is not affected.",
    },
    reasons: [
      "Service resumed at 07:58.",
      "Some trains may still be a few minutes late until about 09:00.",
    ],
    line: [
      { time: c("08:02"), train: "IR 15", state: "ok", note: "About +6 min" },
      { time: c("08:32"), train: "IR 15", state: "ok", note: "On time" },
    ],
    options: [],
    footer: "Tomorrow: no disruption expected for your 07:32.",
  },
];

export const COMMUTER_START_CLOCK = c("06:58");
