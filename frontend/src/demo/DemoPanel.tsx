// Presenter-only controls, outside the phone. Toggle with the "D" key.
// Drives both demos: replay the incident versions (delay mode) and send the
// commuter alerts (push notifications), independently of each other.
import { useStore } from "../store";
import { USE_MOCKS } from "../api/client";
import { COMMUTER_ALERTS, DELAY_STEPS } from "../mocks/scenario";
import { DEFAULT_PREFERENCES } from "../types";
import { hhmm } from "../lib/format";
import { enableOsNotifications, osNotificationsSupported } from "../lib/osNotifications";

export default function DemoPanel({ onClose }: { onClose: () => void }) {
  const s = useStore();

  function startDelay() {
    s.setDelayStep(0);
    s.setPrefs(DEFAULT_PREFERENCES);
    s.reset({ name: "home" });
  }

  function startCommuter() {
    s.resetCommuter();
    s.reset({ name: "lock" });
  }

  async function toggleOs() {
    if (s.osEnabled) return s.setOsEnabled(false);
    s.setOsEnabled(await enableOsNotifications());
  }

  return (
    <aside className="demo-panel" aria-label="Presenter controls">
      <div className="demo-head">
        <strong>Presenter controls</strong>
        <button className="demo-close" onClick={onClose} aria-label="Hide panel">Hide (D)</button>
      </div>
      <div className="demo-meta">Data: {USE_MOCKS ? "replayed scenario (mock)" : "backend, mock fallback"}</div>

      <section>
        <h3>1 · Delay mode</h3>
        <p>Lausanne → Bern, IC 1 at 17:20. Real incident of 25.09.2026 (fire, Puidoux – Vauderens).</p>
        <div className="demo-row">
          <button onClick={startDelay}>Start from “My trips”</button>
          <button onClick={() => s.reset({ name: "disruption" })}>Open “Need help”</button>
        </div>
        <ol className="demo-steps">
          {DELAY_STEPS.map((st, i) => (
            <li key={st.label}>
              <button className={s.delayStep === i ? "active" : ""} onClick={() => s.setDelayStep(i)}>{st.label}</button>
            </li>
          ))}
        </ol>
        <div className="demo-row">
          <button disabled={s.delayStep >= DELAY_STEPS.length - 1} onClick={() => s.setDelayStep(s.delayStep + 1)}>Next SBB update →</button>
        </div>
      </section>

      <section>
        <h3>2 · Commuter alerts</h3>
        <p>Regular trip Lausanne → Fribourg, IR 15 at 07:32. Separate from delay mode.</p>
        <div className="demo-row">
          <button onClick={startCommuter}>Show lock screen</button>
          <button onClick={() => s.reset({ name: "home" })}>Show app</button>
        </div>
        <ol className="demo-steps">
          {COMMUTER_ALERTS.map((a, i) => (
            <li key={a.notification.id}>
              <button className={s.delivered > i ? "active" : ""} onClick={() => s.deliverAlert(i)}>
                Send {hhmm(a.clock)} · {a.notification.title}
              </button>
            </li>
          ))}
        </ol>
        <div className="demo-row">
          <button onClick={s.resetCommuter}>Clear alerts</button>
          {osNotificationsSupported() && (
            <label className="demo-check">
              <input type="checkbox" checked={s.osEnabled} onChange={toggleOs} /> Also send real OS notifications
            </label>
          )}
        </div>
      </section>
    </aside>
  );
}
