import type { AlternativeCategory, Preferences } from "../types";

export const CATEGORIES: AlternativeCategory[] = ["fastest", "nearby", "comfort", "wait"];

export const CATEGORY_META: Record<AlternativeCategory, { label: string; short: string; icon: string; sort: string }> = {
  fastest: { label: "Fastest arrival", short: "Fastest", icon: "bolt", sort: "Sorted by arrival time at your destination." },
  nearby: { label: "Within your radius", short: "Radius", icon: "target", sort: "Stops close to your destination, sorted by arrival time." },
  comfort: { label: "Most comfortable", short: "Comfort", icon: "cup", sort: "Sorted by number of transfers, then arrival time." },
  wait: { label: "Wait for reopening", short: "Wait", icon: "clock", sort: "Staying on your planned route, using the reopening estimate." },
};

export function eyebrow(c: AlternativeCategory, p: Preferences): string {
  if (c === "nearby") return `Within ${p.destination_radius_km} km`;
  return CATEGORY_META[c].label;
}
