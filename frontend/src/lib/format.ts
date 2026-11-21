// Time and number formatting. All times are shown in Swiss local time.
const TZ = "Europe/Zurich";

export function hhmm(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
}

export function dayLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
}

export function minutesBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60_000);
}

export function addMinutes(iso: string, m: number): string {
  return new Date(new Date(iso).getTime() + m * 60_000).toISOString();
}

export function pct(p: number): string {
  return `${Math.round(p * 100)}%`;
}

export function durationLabel(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${String(m).padStart(2, "0")}` : `${h} h`;
}

export function relativeLabel(from: string, now: string): string {
  const m = minutesBetween(from, now);
  if (m <= 0) return "just now";
  if (m < 60) return `${m} min ago`;
  return `${durationLabel(m)} ago`;
}

/** Build an ISO time from "HH:MM" on a given day (YYYY-MM-DD), Swiss local time (CET or CEST). */
export function atTime(day: string, time: string): string {
  const guess = new Date(`${day}T${time}:00Z`);
  const offsetMin = (new Date(guess.toLocaleString("en-US", { timeZone: TZ })).getTime()
    - new Date(guess.toLocaleString("en-US", { timeZone: "UTC" })).getTime()) / 60_000;
  return new Date(guess.getTime() - offsetMin * 60_000).toISOString();
}

/** Swiss calendar day (YYYY-MM-DD) of an ISO time. */
export function swissDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ });
}
