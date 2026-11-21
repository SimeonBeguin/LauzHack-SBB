// "My trips": entry point. Today's disrupted journey (-> Need help) and the
// registered regular trips (-> commuter alerts).
import { useStore } from "../store";
import { COMMUTER_ALERTS } from "../mocks/scenario";
import { hhmm } from "../lib/format";
import { Header, Icon, LineBadge, SectionTitle } from "../components/ui";

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
      <Header title="My trips" />
      <div className="content">
        <SectionTitle>Today</SectionTitle>
        {j && status && (
          <article className="card trip-card">
            <div className="trip-line">
              <LineBadge line={j.line} mode="train" />
              <span className="muted small">Direction Bern · Pl. 7</span>
            </div>
            <div className="trip-times">
              <div><strong>{hhmm(j.departure)}</strong><span>{j.origin.name}</span></div>
              <div className="trip-arrow" aria-hidden="true" />
              <div className="right"><strong>{hhmm(j.arrival)}</strong><span>{j.destination.name}</span></div>
            </div>
            {resolved ? (
              <div className="trip-alert ok"><Icon name="check" size={18} /><span>Trains are running again</span></div>
            ) : (
              <div className="trip-alert"><Icon name="alert" size={18} /><span><strong>Your train does not run.</strong> {status.reason}.</span></div>
            )}
            <button className="btn btn-primary" onClick={() => push({ name: "disruption" })}>
              {resolved ? "Check my journey" : "What should I do?"}
            </button>
          </article>
        )}

        <SectionTitle>Regular trips</SectionTitle>
        {trips.map((t) => (
          <button key={t.id} className="card trip-card" onClick={() => push({ name: "commuterSetup" })}>
            <div className="trip-line">
              <LineBadge line={t.line ?? "Train"} mode="train" />
              <span className="alerts-on"><Icon name="bell" size={14} /> Alerts on · {weekdaysLabel(t.weekdays)}</span>
            </div>
            <div className="trip-times">
              <div><strong>{t.departure_time}</strong><span>{t.origin_name}</span></div>
              <div className="trip-arrow" aria-hidden="true" />
              <div className="right"><strong>{t.arrival_time ?? ""}</strong><span>{t.destination_name}</span></div>
            </div>
          </button>
        ))}
        <button className="btn btn-secondary" onClick={() => push({ name: "commuterSetup" })}>
          <Icon name="plus" size={18} /> Add a regular trip
        </button>

        {delivered > 0 && (
          <>
            <SectionTitle>Messages</SectionTitle>
            <div className="card list-card">
              {COMMUTER_ALERTS.slice(0, delivered).reverse().map((a, ri) => (
                <button key={a.notification.id} className="option-row" onClick={() => push({ name: "commuterAlert", index: delivered - 1 - ri })}>
                  <span className="option-text">
                    <strong>{a.notification.title}</strong>
                    <span className="muted small">{hhmm(a.notification.created_at)}</span>
                  </span>
                  <Icon name="chevron" size={18} className="muted" />
                </button>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
