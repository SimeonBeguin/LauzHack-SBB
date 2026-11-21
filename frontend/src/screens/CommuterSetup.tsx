// Register a regular trip to get predictive alerts, including when an
// EARLIER train on the same line is hit. Stations come from the SBB service
// points (backend search); line and arrival from the timetable.
import { useEffect, useState } from "react";
import { registerCommuterTrip, searchStops, USER_ID } from "../api/client";
import { useStore } from "../store";
import { hhmm } from "../lib/format";
import { enableOsNotifications, osNotificationsSupported } from "../lib/osNotifications";
import { Chip, Header, Icon } from "../components/ui";
import type { CommuterTrip, Stop } from "../types";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function StopField({ label, value, onChange }: { label: string; value: Stop | null; onChange: (s: Stop | null) => void }) {
  const [text, setText] = useState(value?.name ?? "");
  const [options, setOptions] = useState<Stop[]>([]);
  const listId = `stops-${label}`;

  useEffect(() => { setText(value?.name ?? ""); }, [value?.id]);

  useEffect(() => {
    if (text.trim().length < 2 || text === value?.name) return;
    const t = window.setTimeout(() => {
      searchStops(text).then((found) => {
        setOptions(found);
        const exact = found.find((s) => s.name.toLowerCase() === text.trim().toLowerCase());
        if (exact) onChange(exact);
      }).catch(() => setOptions([]));
    }, 250);
    return () => window.clearTimeout(t);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="field">
      <span>{label}</span>
      <input list={listId} value={text} placeholder="Station" onChange={(e) => {
        setText(e.target.value);
        const picked = options.find((s) => s.name === e.target.value);
        onChange(picked ?? null);
      }} />
      <datalist id={listId}>{options.map((s) => <option key={s.id} value={s.name} />)}</datalist>
    </label>
  );
}

export default function CommuterSetup() {
  const { back, trips, saveTrip, showToast, osEnabled, setOsEnabled, status } = useStore();
  const existing = trips[0];
  const j = status?.journey;
  const initial = (id?: string, name?: string | null): Stop | null => (id ? { id, name: name ?? id } : null);
  const [origin, setOrigin] = useState<Stop | null>(
    existing ? initial(existing.origin_stop_id, existing.origin_name) : j?.origin ?? null);
  const [destination, setDestination] = useState<Stop | null>(
    existing ? initial(existing.destination_stop_id, existing.destination_name) : j?.destination ?? null);
  const [time, setTime] = useState(existing?.departure_time ?? (j ? hhmm(j.departure) : ""));
  const [days, setDays] = useState<number[]>(existing?.weekdays ?? [0, 1, 2, 3, 4]);
  const [saving, setSaving] = useState(false);

  const toggleDay = (d: number) => setDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d].sort()));

  async function enableOs() {
    const ok = await enableOsNotifications();
    setOsEnabled(ok);
    showToast(ok ? "Phone notifications on" : "Notifications blocked by the browser");
  }

  async function save() {
    if (!origin || !destination) return;
    setSaving(true);
    const trip: CommuterTrip = {
      id: existing?.id ?? null, user_id: USER_ID,
      origin_stop_id: origin.id, destination_stop_id: destination.id,
      origin_name: origin.name, destination_name: destination.name,
      departure_time: time, weekdays: days,
    };
    try {
      const saved = await registerCommuterTrip(trip);
      saveTrip(saved);
      showToast(`Alerts on for ${saved.origin_name} → ${saved.destination_name} at ${saved.departure_time}`);
      back();
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <Header title="Regular trip" onBack={back} />
      <div className="content overlap">
        <p className="intro-card card">
          We warn you before your train is affected, even when the problem starts on an earlier train on your line.
          We start watching 2 hours before your usual departure.
        </p>
        <section className="card form">
          <StopField label="From" value={origin} onChange={setOrigin} />
          <StopField label="To" value={destination} onChange={setDestination} />
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

        <button className="btn btn-primary btn-lg" onClick={save}
          disabled={saving || days.length === 0 || !origin || !destination || origin.id === destination.id || !time}>
          {saving ? "Saving…" : "Save and turn on alerts"}
        </button>
      </div>
    </>
  );
}
