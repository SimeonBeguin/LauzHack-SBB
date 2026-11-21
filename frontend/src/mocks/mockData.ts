import type { AlternativesResponse, DisruptionStatus, Stop } from "../types";

const fribourg: Stop = { id: "8504100", name: "Fribourg/Freiburg" };
const inMinutes = (m: number) => new Date(Date.now() + m * 60_000).toISOString();

export const mockStatus: DisruptionStatus = {
  incident_id: "2195004439194",
  journey_id: "demo-1",
  title: "MOCK: Interruption Lausanne - Fribourg",
  reason: "Technical fault",
  affected_section: "Palézieux - Romont",
  estimate: {
    official_end: inMinutes(60),
    likely_end_earliest: inMinutes(50),
    likely_end_latest: inMinutes(90),
    confidence: 0.6,
    similar_incidents_count: 0,
    explanation: "MOCK estimate",
  },
  last_update: inMinutes(0),
};

const alt = (id: string, category: "fastest" | "nearby" | "comfort" | "wait", m: number, transfers: number) => ({
  id, category, legs: [], arrival: inMinutes(m), final_stop: fribourg,
  distance_to_destination_km: 0, transfers, score: 0, ticket_valid: true, ticket_hint: "MOCK ticket hint",
});

export const mockAlternatives: AlternativesResponse = {
  journey_id: "demo-1",
  by_category: {
    fastest: [alt("f1", "fastest", 70, 2)],
    nearby: [alt("n1", "nearby", 60, 1)],
    comfort: [alt("c1", "comfort", 100, 0)],
    wait: [alt("w1", "wait", 115, 0)],
  },
};
