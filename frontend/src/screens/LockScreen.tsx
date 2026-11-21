// Simulated phone lock screen: the commuter alerts sent by the backend.
import { useStore } from "../store";
import type { CommuterAlert } from "../types";
import { dayLabel, hhmm } from "../lib/format";
import { Icon } from "../components/ui";

export function NotificationCard({ alert, onOpen, now }: { alert: CommuterAlert; onOpen: () => void; now?: string }) {
  const n = alert.notification;
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

export default function LockScreen() {
  const { clock, alerts, push } = useStore();
  const items = [...alerts].reverse();

  return (
    <div className="lock">
      <div className="lock-top">
        <Icon name="lock" size={18} />
        <div className="lock-date">{dayLabel(clock)}</div>
        <div className="lock-time">{hhmm(clock)}</div>
      </div>
      <div className="lock-stack">
        {items.map((a) => (
          <NotificationCard key={a.notification.id} alert={a} now={clock}
            onOpen={() => push({ name: "commuterAlert", id: a.notification.id ?? "" })} />
        ))}
      </div>
      <div className="lock-hint">{items.length ? "Tap a notification to open it" : "No notifications"}</div>
    </div>
  );
}
