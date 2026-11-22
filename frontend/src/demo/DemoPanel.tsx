// Presenter-only controls, outside the phone. Toggle with the "D" key.
// They change the live situation on the backend (time, time announced by SBB,
// replacement buses, reopening); the app, the alternatives and the commuter
// alerts all follow from it. The traffic-jam control only changes what the
// prevention checks see (booked trips, bus delay forecasts).
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { JOURNEY_ID } from "../api/client";
import { atTime, hhmm, swissDay } from "../lib/format";
import { enableOsNotifications, osNotificationsSupported } from "../lib/osNotifications";
import { COPPET_STEPS } from "./coppetScenario";

export default function DemoPanel({ onClose }: { onClose: () => void }) {
  const s = useStore();
  const sit = s.situation;
  const [endInput, setEndInput] = useState("");

  useEffect(() => {
    if (sit?.official_end) setEndInput(hhmm(sit.official_end));
  }, [sit?.official_end]);

  async function toggleOs() {
    if (s.osEnabled) return s.setOsEnabled(false);
    s.setOsEnabled(await enableOsNotifications());
  }

  function publishEnd() {
    if (!sit || !/^\d\d:\d\d$/.test(endInput)) return;
    void s.act({ action: "set_official_end", time: atTime(swissDay(sit.clock), endInput) });
  }

  const j = s.status?.journey;
  const resumed = !!sit?.resumed_at && new Date(sit.resumed_at) <= new Date(sit.clock);

  return (
    <aside className="demo-panel" aria-label="Presenter controls">
      <div className="demo-head">
        <strong>Presenter controls</strong>
        <button className="demo-close" onClick={onClose} aria-label="Hide panel">Hide (D)</button>
      </div>
      {s.error && <div className="demo-meta demo-error">{s.error}</div>}
      {!sit && !s.error && <div className="demo-meta">Loading the situation…</div>}

      {sit && (
        <>
          <div className="demo-meta">
            {j ? `${j.origin.name} → ${j.destination.name}, ${j.line} at ${hhmm(j.departure)}` : JOURNEY_ID}
            {" · "}{sit.mode === "replay" ? "real incident, replayed from the data" : "simulated incident"}
          </div>

          <section>
            <h3>Now: {hhmm(sit.clock)}</h3>
            <p>
              {resumed ? `Line ${sit.section} reopened at ${hhmm(sit.resumed_at)}.`
                : `No trains between ${sit.section} since ${hhmm(sit.start)}. SBB: ${sit.official_end ? `~${hhmm(sit.official_end)}` : "no end time"}. Replacement buses: ${sit.replacement_bus ? "running" : "none"}.`}
            </p>
            <div className="demo-row">
              {[5, 15, 30].map((m) => (
                <button key={m} onClick={() => s.act({ action: "advance", minutes: m })}>+{m} min</button>
              ))}
              {sit.mode === "replay" && (
                <button disabled={!sit.next_update} onClick={() => s.act({ action: "next_update" })}>
                  Next SBB update{sit.next_update ? ` (${hhmm(sit.next_update)})` : ""} →
                </button>
              )}
            </div>
          </section>

          {sit.mode === "simulated" && (
            <section>
              <h3>SBB updates</h3>
              <div className="demo-row">
                <label className="demo-check">
                  SBB expects trains again at
                  <input type="time" value={endInput} disabled={resumed} onChange={(e) => setEndInput(e.target.value)} />
                </label>
                <button disabled={resumed || !endInput || endInput === hhmm(sit.official_end)} onClick={publishEnd}>Publish</button>
              </div>
              <label className="demo-check">
                <input type="checkbox" checked={sit.replacement_bus} disabled={resumed}
                  onChange={(e) => s.act({ action: "replacement_bus", value: e.target.checked })} />
                Replacement buses running ({sit.section})
              </label>
              <div className="demo-row">
                <button disabled={resumed} onClick={() => s.act({ action: "resume" })}>Line reopens now</button>
              </div>
            </section>
          )}

          <section>
            <h3>Published updates</h3>
            <ol className="demo-steps">
              {[...sit.updates].reverse().map((u, i) => (
                <li key={`${u.time}-${i}`} className="demo-update"><b>{hhmm(u.time)}</b> {u.text}</li>
              ))}
            </ol>
            <div className="demo-row">
              <button onClick={() => s.reset({ name: "home" })}>Show app</button>
              <button onClick={() => s.reset({ name: "disruption" })}>Open “Need help”</button>
              <button onClick={() => { s.setSheetOpen(false); s.clearDemoAlerts(); void s.act({ action: "reset" }); }}>Reset the demo</button>
            </div>
          </section>

          <section>
            <h3>Prevention: booked trips and bus delays</h3>
            <p>
              {s.bookings.length
                ? `${s.bookings.length} booked trip(s) watched, ${s.bookingAlerts.length} alert(s) so far.`
                : "No booked trip yet: add one in the app (“Add a booked trip”, a bus then a train with a short change works best)."}
            </p>
            <div className="demo-row">
              <span>Traffic jam on the bus route:</span>
              {[null, 8, 15].map((m) => (
                <button key={String(m)} className={s.jam === m ? "active" : ""} aria-pressed={s.jam === m}
                  onClick={() => s.setJam(m)}>
                  {m ? `+${m} min` : "None"}
                </button>
              ))}
            </div>
            <p className="demo-update">Simulated on every bus leg; works without a TomTom key. SBB’s real-time data does not show it.</p>
          </section>

          <section>
            <h3>Staged alerts: Coppet → Lausanne, 08:19</h3>
            <p className="demo-update">
              Hand-written notifications for the regular morning trip (RE33), after the real incident
              Gland – Nyon of 5 March 2025. Each button shows one like a real alert.
            </p>
            <div className="demo-row">
              {COPPET_STEPS.map((st) => (
                <button key={st.id} onClick={() => s.showDemoAlert(st.build(swissDay(sit.clock)))}>{st.button}</button>
              ))}
              <button onClick={s.clearDemoAlerts}>Clear</button>
            </div>
          </section>

          <section>
            <h3>Commuter alerts</h3>
            <p>
              {s.trips.length
                ? `${s.trips.length} regular trip(s) watched. Alerts appear when the situation affects them (${s.alerts.length} so far).`
                : "No regular trip yet: add one in the app (“Add a regular trip”)."}
            </p>
            <div className="demo-row">
              <button onClick={() => s.reset({ name: "lock" })}>Show lock screen</button>
              {osNotificationsSupported() && (
                <label className="demo-check">
                  <input type="checkbox" checked={s.osEnabled} onChange={toggleOs} /> Also send real OS notifications
                </label>
              )}
            </div>
          </section>
        </>
      )}
    </aside>
  );
}
