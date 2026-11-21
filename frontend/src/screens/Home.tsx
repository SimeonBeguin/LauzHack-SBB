// "My trips": entry point. Today's disrupted journey (-> Need help) and the
// registered regular trips (-> commuter alerts).
import { useStore } from "../store";
import { COMMUTER_ALERTS } from "../mocks/scenario";
import { hhmm } from "../lib/format";
import { Header, Icon, SectionTitle } from "../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekdaysLabel(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.join() === "0,1,2,3,4") return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  return sorted.map((d) => DAYS[d]).join(", ");
}

export default function Home() {
  const { status, push, trips, delivered } = useStore();
  const j = status?.journey;
  const resolved = status?.kind === "resolved";

  return (
    <>
      <Header title="My trips" subtitle="Disruption Helper" />
      <div className="content">
        <SectionTitle>Today</SectionTitle>
        {j && status && (
          <article className={`card trip-card ${resolved ? "" : "trip-disrupted"}`}>
            <div className="trip-line">
              <span className="pill">{j.line}</span>
              <span className="muted small">Platform 7</span>
            </div>
            <div className="trip-times">
              <div><strong>{hhmm(j.departure)}</strong> <span>{j.origin.name}</span></div>
              <div className="trip-arrow">→</div>
              <div><strong>{hhmm(j.arrival)}</strong> <span>{j.destination.name}</span></div>
            </div>
            <div className={`trip-alert ${resolved ? "ok" : ""}`}>
              <Icon name={resolved ? "check" : "alert"} size={18} />
              <span><strong>{status.title}</strong><br />{status.reason}</span>
            </div>
            <button className="btn btn-primary" onClick={() => push({ name: "disruption" })}>
              {resolved ? "See what to do now" : "Need help"}
            </button>
          </article>
        )}

        <SectionTitle>Regular trips</SectionTitle>
        {trips.map((t) => (
          <button key={t.id} className="card trip-card regular" onClick={() => push({ name: "commuterSetup" })}>
            <div className="trip-line">
              <span className="pill">{t.line ?? "Train"}</span>
              <span className="alerts-on"><Icon name="bell" size={14} /> Alerts on</span>
            </div>
            <div className="trip-times">
              <div><strong>{t.departure_time}</strong> <span>{t.origin_name}</span></div>
              <div className="trip-arrow">→</div>
              <div><strong>{t.arrival_time ?? ""}</strong> <span>{t.destination_name}</span></div>
            </div>
            <div className="muted small">{weekdaysLabel(t.weekdays)} · warns you when an earlier train on your line is hit</div>
          </button>
        ))}
        <button className="btn btn-outline" onClick={() => push({ name: "commuterSetup" })}>
          <Icon name="plus" size={18} /> Add a regular trip
        </button>

        {delivered > 0 && (
          <>
            <SectionTitle>Recent alerts</SectionTitle>
            {COMMUTER_ALERTS.slice(0, delivered).reverse().map((a, ri) => {
              const index = delivered - 1 - ri;
              return (
                <button key={a.notification.id} className="card inbox-item" onClick={() => push({ name: "commuterAlert", index })}>
                  <span className="muted small">{hhmm(a.notification.created_at)}</span>
                  <strong>{a.notification.title}</strong>
                  <Icon name="chevron" size={18} />
                </button>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
