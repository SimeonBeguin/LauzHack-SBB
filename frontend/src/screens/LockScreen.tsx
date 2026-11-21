// Simulated phone lock screen: the commuter and booked-trip alerts sent by the backend.
import { useStore } from "../store";
import type { Notification } from "../types";
import { dayLabel, hhmm } from "../lib/format";
import { Icon } from "../components/ui";

export function NotificationCard({ notification: n, onOpen, now }: { notification: Notification; onOpen: () => void; now?: string }) {
  const isNow = now && n.created_at === now;
  return (
    <button className={`notif notif-${n.kind}`} onClick={onOpen}>
      <img src="/icon.svg" alt="" className="notif-icon" />
      <span className="notif-body">
        <span className="notif-head">
          <span>Disruption Helper</span>
          <span>{isNow ? "now" : hhmm(n.created_at)}</span>
        </span>
        <strong>{n.title}</strong>
        <span>{n.body}</span>
      </span>
    </button>
  );
}

/** Commuter and booked-trip notifications, newest first. */
export function allNotifications(lists: { notification: Notification }[][]): Notification[] {
  return lists.flat().map((a) => a.notification)
    .sort((x, y) => new Date(y.created_at).getTime() - new Date(x.created_at).getTime());
}

export default function LockScreen() {
  const { clock, alerts, bookingAlerts, openAlert } = useStore();
  const items = allNotifications([alerts, bookingAlerts]);

  return (
    <div className="lock">
      <div className="lock-top">
        <Icon name="lock" size={18} />
        <div className="lock-date">{dayLabel(clock)}</div>
        <div className="lock-time">{hhmm(clock)}</div>
      </div>
      <div className="lock-stack">
        {items.map((n) => (
          <NotificationCard key={n.id} notification={n} now={clock} onOpen={() => openAlert(n.id ?? "")} />
        ))}
      </div>
      <div className="lock-hint">{items.length ? "Tap a notification to open it" : "No notifications"}</div>
    </div>
  );
}
