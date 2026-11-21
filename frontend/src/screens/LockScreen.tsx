// Simulated phone lock screen for the commuter alert demo.
import { useStore } from "../store";
import { COMMUTER_ALERTS } from "../mocks/scenario";
import { dayLabel, hhmm } from "../lib/format";
import { Icon } from "../components/ui";

export function NotificationCard({ index, onOpen, now }: { index: number; onOpen: () => void; now?: string }) {
  const n = COMMUTER_ALERTS[index].notification;
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
  const { clock, delivered, push } = useStore();
  const items = Array.from({ length: delivered }, (_, i) => delivered - 1 - i);

  return (
    <div className="lock">
      <div className="lock-top">
        <Icon name="lock" size={18} />
        <div className="lock-date">{dayLabel(clock)}</div>
        <div className="lock-time">{hhmm(clock)}</div>
      </div>
      <div className="lock-stack">
        {items.map((i) => (
          <NotificationCard key={i} index={i} now={clock} onOpen={() => push({ name: "commuterAlert", index: i })} />
        ))}
      </div>
      <div className="lock-hint">{delivered ? "Tap a notification to open it" : "No notifications"}</div>
    </div>
  );
}
