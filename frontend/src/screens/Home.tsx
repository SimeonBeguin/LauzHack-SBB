// "My trips": entry point. Today's disrupted journey (-> Need help), the
// registered regular trips (-> commuter alerts) and the booked trips
// (-> booked-trip alerts, Prevention idea 2).
import { useEffect, useState } from "react";
import { getBookingStatus } from "../api/client";
import { useStore } from "../store";
import type { BookedTrip, BookingStatus } from "../types";
import { dayLabel, durationLabel, hhmm, minutesBetween } from "../lib/format";
import { Header, Icon, LineBadge, PillRow, SectionTitle, TimeLine } from "../components/ui";
import { allNotifications } from "./LockScreen";
import { TICKET_LABEL } from "./BookingSetup";

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

/** Current check of each booked trip; refreshed when the situation, the jam or the alerts change. */
function useBookingStatuses(bookings: BookedTrip[], refreshKey: string): Record<string, BookingStatus> {
  const { jam } = useStore();
  const [out, setOut] = useState<Record<string, BookingStatus>>({});
  useEffect(() => {
    let alive = true;
    for (const b of bookings) {
      if (!b.id) continue;
      getBookingStatus(b.id, jam).then((st) => alive && setOut((o) => ({ ...o, [b.id!]: st }))).catch(() => {});
    }
    return () => { alive = false; };
  }, [bookings, jam, refreshKey]);
  return out;
}

function BookedTripCard({ b, st, onOpen, onRemove }: {
  b: BookedTrip; st?: BookingStatus; onOpen?: () => void; onRemove: () => void;
}) {
  const first = b.legs?.find((l) => l.mode !== "walk" && l.mode !== "wait");
  const state = st?.state;
  return (
    <section className="card summary">
      <h2 className="summary-title">{b.origin_name} <span className="arrow">→</span> {b.destination_name}</h2>
      {b.legs?.length ? (
        <span className="booked-line">{first && <LineBadge line={first.line} mode={first.mode} />}<TimeLine legs={b.legs} /></span>
      ) : (
        <div className="timeline"><strong>{hhmm(b.departure)}</strong><span className="tl-track" /><strong>{hhmm(b.arrival)}</strong></div>
      )}
      <p className="summary-sub">
        {dayLabel(b.departure)} · {TICKET_LABEL[b.ticket_kind ?? "supersaver"]}
        {state !== "not_watched" && <> · <Icon name="bell" size={14} /> Watched</>}
      </p>
      {state === "at_risk" && (
        <div className="trip-alert warn"><Icon name="alert" size={20} /><span><b>Your change may be tight.</b> {st!.summary}</span></div>
      )}
      {(state === "broken" || state === "disrupted") && (
        <div className="trip-alert"><Icon name="alert" size={20} /><span><b>{st!.summary}</b></span></div>
      )}
      {state === "not_watched" && <p className="muted small">{st!.summary}</p>}
      {(state === "broken" || state === "disrupted") && onOpen && (
        <button className="btn btn-primary" onClick={onOpen}>What should I do?</button>
      )}
      <button className="link small-link" onClick={onRemove}>Remove</button>
    </section>
  );
}

export default function Home() {
  const { status, push, trips, alerts, error, bookings, bookingAlerts, removeBooking, openAlert, situation } = useStore();
  const statuses = useBookingStatuses(bookings, `${situation?.clock}|${bookingAlerts.length}`);
  const latestAlertOf = (id?: string | null) =>
    [...bookingAlerts].reverse().find((a) => a.booking.id === id && a.notification.kind !== "booking_back_to_normal");
  const messages = allNotifications([alerts, bookingAlerts]);
  const j = status?.journey;
  const resolved = status?.kind === "resolved";

  return (
    <>
      <Header title="My trips" />
      <div className="content overlap">
        {error && <p className="card error-card">{error}</p>}
        {j && status && (
          <section className="card summary">
            <h2 className="summary-title">{j.origin.name} <span className="arrow">→</span> {j.destination.name}</h2>
            <div className={`timeline ${resolved ? "" : "cancelled"}`}>
              <LineBadge line={j.line} mode="train" />
              <strong>{hhmm(j.departure)}</strong>
              <span className="tl-track" aria-hidden="true" />
              <strong>{hhmm(j.arrival)}</strong>
            </div>
            <p className="summary-sub">{dayLabel(j.departure)}, {durationLabel(minutesBetween(j.departure, j.arrival))}</p>
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

        <SectionTitle>Booked trips</SectionTitle>
        {bookings.map((b) => {
          const alert = latestAlertOf(b.id);
          return (
            <BookedTripCard key={b.id} b={b} st={b.id ? statuses[b.id] : undefined}
              onOpen={alert ? () => openAlert(alert.notification.id ?? "") : undefined}
              onRemove={() => b.id && removeBooking(b.id)} />
          );
        })}
        <div className="pill-stack">
          <PillRow icon="ticket" onClick={() => push({ name: "bookingSetup" })}>
            Add a booked trip <span className="pill-sub">Ticket already bought? We watch your connections.</span>
          </PillRow>
          <PillRow icon="plan" onClick={() => push({ name: "plan" })}>
            Plan a trip <span className="pill-sub">Connections ranked by reliability at that hour</span>
          </PillRow>
        </div>

        {messages.length > 0 && (
          <>
            <SectionTitle>Messages</SectionTitle>
            <div className="pill-stack">
              {messages.map((n) => (
                <PillRow key={n.id} icon="bell" lead={<span className="pill-min">{hhmm(n.created_at)}</span>}
                  onClick={() => openAlert(n.id ?? "")}>
                  {n.title}
                </PillRow>
              ))}
            </div>
          </>
        )}
      </div>
    </>
  );
}
