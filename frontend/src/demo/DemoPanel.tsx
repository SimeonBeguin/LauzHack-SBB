// Presenter-only controls, outside the phone. Toggle with the "D" key.
// They change the live situation on the backend (time, time announced by SBB,
// replacement buses, reopening); the app, the alternatives and the commuter
// alerts all follow from it.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import { JOURNEY_ID } from "../api/client";
import { atTime, hhmm, swissDay } from "../lib/format";
import { enableOsNotifications, osNotificationsSupported } from "../lib/osNotifications";

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
              <button onClick={() => { s.setSheetOpen(false); void s.act({ action: "reset" }); }}>Reset the demo</button>
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
