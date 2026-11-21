import type { AlternativeCategory } from "../types";

export const CATEGORIES: AlternativeCategory[] = ["fastest", "nearby", "comfort", "wait"];

export const CATEGORY_META: Record<AlternativeCategory, { label: string; short: string; sort: string }> = {
  fastest: { label: "Fastest", short: "Fastest", sort: "Earliest arrival first." },
  nearby: { label: "Get off nearby", short: "Nearby", sort: "Stations close to your destination." },
  comfort: { label: "Easiest", short: "Easiest", sort: "Most reliable, fewest changes first." },
  wait: { label: "Wait", short: "Wait", sort: "Stay on your planned train and wait for the line to reopen." },
};
