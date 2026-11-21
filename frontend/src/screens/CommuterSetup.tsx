// Register a regular trip to get predictive alerts, including when an
// EARLIER train on the same line is hit.
import { useState } from "react";
import { registerCommuterTrip } from "../api/client";
import { useStore } from "../store";
import { STOP_OPTIONS } from "../mocks/scenario";
import { enableOsNotifications, osNotificationsSupported } from "../lib/osNotifications";
import { Chip, Header, Icon } from "../components/ui";
import type { CommuterTrip } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export default function CommuterSetup() {
  const { back, trips, saveTrip, showToast, osEnabled, setOsEnabled } = useStore();
  const existing = trips[0];
  const [origin, setOrigin] = useState(existing?.origin_stop_id ?? STOP_OPTIONS[0].id);
  const [destination, setDestination] = useState(existing?.destination_stop_id ?? STOP_OPTIONS[2].id);
  const [time, setTime] = useState(existing?.departure_time ?? "07:32");
  const [days, setDays] = useState<number[]>(existing?.weekdays ?? [0, 1, 2, 3, 4]);
  const [earlierTrains, setEarlierTrains] = useState(true);
  const [lead, setLead] = useState(45);
  const [saving, setSaving] = useState(false);

  const name = (id: string) => STOP_OPTIONS.find((s) => s.id === id)?.name ?? id;
  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));

  async function enableOs() {
    const ok = await enableOsNotifications();
    setOsEnabled(ok);
    showToast(ok ? "Phone notifications on" : "Notifications blocked by the browser");
  }

  async function save() {
    setSaving(true);
    const trip: CommuterTrip = {
      id: existing?.id ?? null, user_id: "demo-user",
      origin_stop_id: origin, destination_stop_id: destination,
      origin_name: name(origin), destination_name: name(destination),
      departure_time: time, weekdays: days,
      line: existing && existing.origin_stop_id === origin && existing.destination_stop_id === destination ? existing.line : null,
      arrival_time: existing && existing.departure_time === time ? existing.arrival_time : null,
    };
    const saved = await registerCommuterTrip(trip);
    saveTrip(saved);
    setSaving(false);
    showToast(`Alerts on for ${name(origin)} → ${name(destination)} at ${time}`);
    back();
  }

  return (
    <>
      <Header title="Regular trip" onBack={back} />
      <div className="content overlap">
        <p className="intro-card card">We warn you before your train is affected, even when the problem starts on an earlier train.</p>
        <section className="card form">
          <label className="field">
            <span>From</span>
            <select value={origin} onChange={(e) => setOrigin(e.target.value)}>
              {STOP_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>To</span>
            <select value={destination} onChange={(e) => setDestination(e.target.value)}>
              {STOP_OPTIONS.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span>Usual departure</span>
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </label>
          <div className="field">
            <span>Days</span>
            <div className="chips">
              {DAYS.map((d, i) => <Chip key={d} active={days.includes(i)} onClick={() => toggleDay(i)}>{d}</Chip>)}
            </div>
          </div>
        </section>

        <section className="card form">
          <label className="toggle">
            <span>
              <strong>Early warning</strong>
              <span className="muted small">Alert me when an earlier train on my line is hit, with the chance my own train is affected.</span>
            </span>
            <input type="checkbox" checked={earlierTrains} onChange={(e) => setEarlierTrains(e.target.checked)} />
          </label>
          <label className="field">
            <span>Start watching</span>
            <select value={lead} onChange={(e) => setLead(Number(e.target.value))}>
              {[30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min before departure</option>)}
            </select>
          </label>
        </section>

        <section className="card form">
          <div className="toggle">
            <span>
              <strong><Icon name="bell" size={16} /> Phone notifications</strong>
              <span className="muted small">
                {osEnabled ? "On. Alerts also appear as system notifications."
                  : osNotificationsSupported() ? "Allow notifications in this browser." : "Not supported in this browser."}
              </span>
            </span>
            {!osEnabled && osNotificationsSupported() && <button className="btn btn-small" onClick={enableOs}>Allow</button>}
          </div>
        </section>

        <button className="btn btn-primary btn-lg" onClick={save} disabled={saving || days.length === 0 || origin === destination}>
          {saving ? "Saving…" : "Save and turn on alerts"}
        </button>
      </div>
    </>
  );
}
