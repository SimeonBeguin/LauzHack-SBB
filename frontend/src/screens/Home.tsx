// "My trips": entry point. Today's disrupted journey (-> Need help) and the
// registered regular trips (-> commuter alerts).
import { useStore } from "../store";
import { COMMUTER_ALERTS } from "../mocks/scenario";
import { durationLabel, hhmm, minutesBetween } from "../lib/format";
import { Header, Icon, LineBadge, PillRow, SectionTitle } from "../components/ui";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function weekdaysLabel(days: number[]): string {
  const sorted = [...days].sort();
  if (sorted.join() === "0,1,2,3,4") return "Mon–Fri";
  if (sorted.length === 7) return "Every day";
  return sorted.map((d) => DAYS[d]).join(", ");
}

function hm(t: string) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}

export default function Home() {
  const { status, push, trips, delivered } = useStore();
  const j = status?.journey;
  const resolved = status?.kind === "resolved";

  return (
    <>
      <Header title="My trips" />
      <div className="content overlap">
        {j && status && (
          <section className="card summary">
            <h2 className="summary-title">{j.origin.name} <span className="arrow">→</span> {j.destination.name}</h2>
            <div className={`timeline ${resolved ? "" : "cancelled"}`}>
              <LineBadge line={j.line} mode="train" />
              <strong>{hhmm(j.departure)}</strong>
              <span className="tl-track" aria-hidden="true" />
              <strong>{hhmm(j.arrival)}</strong>
            </div>
            <p className="summary-sub">Today, {durationLabel(minutesBetween(j.departure, j.arrival))} · Pl. 7</p>
            {resolved ? (
              <div className="trip-alert ok"><Icon name="check" size={20} /><span>Trains are running again</span></div>
            ) : (
              <div className="trip-alert"><Icon name="alert" size={20} /><span><b>Your train does not run.</b> {status.reason}.</span></div>
            )}
            <button className="btn btn-primary" onClick={() => push({ name: "disruption" })}>
              {resolved ? "Check my journey" : "What should I do?"}
            </button>
          </section>
        )}

        <SectionTitle>Regular trips</SectionTitle>
        {trips.map((t) => (
          <button key={t.id} className="card summary" onClick={() => push({ name: "commuterSetup" })}>
            <h2 className="summary-title">{t.origin_name} <span className="arrow">→</span> {t.destination_name}</h2>
            <div className="timeline">
              <LineBadge line={t.line ?? "Train"} mode="train" />
              <strong>{t.departure_time}</strong>
              <span className="tl-track" aria-hidden="true" />
              <strong>{t.arrival_time ?? ""}</strong>
            </div>
            <p className="summary-sub">
              {weekdaysLabel(t.weekdays)}
              {t.arrival_time ? `, ${durationLabel(hm(t.arrival_time) - hm(t.departure_time))}` : ""} · <Icon name="bell" size={14} /> Alerts on
            </p>
          </button>
        ))}
        <div className="pill-stack">
          <PillRow icon="plus" onClick={() => push({ name: "commuterSetup" })}>Add a regular trip</PillRow>
        </div>

        {delivered > 0 && (
          <>
            <SectionTitle>Messages</SectionTitle>
            <div className="pill-stack">
              {COMMUTER_ALERTS.slice(0, delivered).reverse().map((a, ri) => (
                <PillRow key={a.notification.id} icon="bell" lead={<span className="pill-min">{hhmm(a.notification.created_at)}</span>}
                  onClick={() => push({ name: "commuterAlert", index: delivered - 1 - ri })}>
                  {a.notification.title}
                </PillRow>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
