// Shared UI pieces, styled after the SBB Mobile app: white top bar, line
// pictograms, connection line with change dots, red primary buttons.
import type { ReactNode } from "react";
import type { Alternative, Certainty, Leg } from "../types";
import { durationLabel, hhmm, minutesBetween } from "../lib/format";
import { chanceLabel, RELIABILITY, type ChanceLabel } from "../lib/chance";

// ---------------------------------------------------------------------------
// Icons (inline SVG, inherit currentColor)
// ---------------------------------------------------------------------------
const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M12 3l10 18H2z" fill="currentColor" stroke="none" /><path d="M12 10v5M12 17.6v.4" stroke="#fff" strokeWidth="2.2" /></>,
  check: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  ticket: <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" />,
  timetable: <><circle cx="11" cy="11" r="6" /><path d="M20 20l-4.5-4.5" /></>,
  trips: <><rect x="4" y="5" width="16" height="15" rx="2" /><path d="M4 10h16M9 3v4M15 3v4" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Top bar
// ---------------------------------------------------------------------------
export function Header({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="app-header">
      {onBack && <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={24} /></button>}
      <div className="app-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Line pictogram ("IC 5", "S 30", "EV" for replacement bus)
// ---------------------------------------------------------------------------
export function LineBadge({ line, mode }: { line: string | null; mode?: string }) {
  if (mode === "walk" || mode === "wait") return null;
  const label = mode === "replacement_bus" ? "EV" : line ?? "Bus";
  const kind = mode === "replacement_bus" ? "ev"
    : /^(IC|IR|EC|ICE|TGV)/.test(label) ? "long"
    : /^(RE|R)\b/.test(label) ? "regio"
    : /^S/.test(label) ? "s"
    : "bus";
  return <span className={`line-badge lb-${kind}`}>{label}</span>;
}

export function LineBadges({ legs }: { legs: Leg[] }) {
  return (
    <span className="line-badges">
      {legs.filter((l) => l.mode !== "wait" && l.mode !== "walk").map((l, i) => <LineBadge key={i} line={l.line} mode={l.mode} />)}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Connection line: 17:15 ●──●──● 18:40
// ---------------------------------------------------------------------------
export function ConnectionLine({ alt }: { alt: Alternative }) {
  const moving = alt.legs.filter((l) => l.mode !== "wait");
  const first = moving[0] ?? alt.legs[0];
  const last = alt.legs[alt.legs.length - 1];
  const total = Math.max(1, minutesBetween(first.departure, last.arrival));
  return (
    <div className="conn">
      <div className="conn-times">
        <strong>{hhmm(first.departure)}</strong>
        <span className="muted small">{durationLabel(total)}</span>
        <strong className={alt.arrival_latest ? "late" : ""}>{alt.arrival_latest ? `${hhmm(alt.arrival)}+` : hhmm(alt.arrival)}</strong>
      </div>
      <div className="conn-line" aria-hidden="true">
        {moving.map((l, i) => (
          <span key={i} className={`conn-seg conn-${l.mode}`}
            style={{ flexGrow: Math.max(0.08, minutesBetween(l.departure, l.arrival) / total) }} />
        ))}
      </div>
      <div className="conn-stops muted small">
        <span>{first.from_stop.name}</span>
        <span>{alt.transfers === 0 ? "Direct" : `${alt.transfers} change${alt.transfers > 1 ? "s" : ""}`}</span>
        <span>{alt.final_stop.name}</span>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chance badge: one word + colour + "x in 10"
// ---------------------------------------------------------------------------
export function labelFor(alt: Pick<Alternative, "on_time_probability" | "certainty">): ChanceLabel | null {
  if (alt.on_time_probability != null) return chanceLabel(alt.on_time_probability);
  return alt.certainty ? RELIABILITY[alt.certainty] : null;
}

export function ChanceBadge({ label, suffix, big }: { label: ChanceLabel | null; suffix?: string; big?: boolean }) {
  if (!label) return null;
  return (
    <span className={`chance chance-${label.tone} ${big ? "chance-big" : ""}`}>
      <span className="chance-dot" aria-hidden="true" />
      <span>
        <strong>{label.word}{suffix ? ` ${suffix}` : ""}</strong>
        {label.freq && <span className="chance-freq"> · {label.freq}</span>}
      </span>
    </span>
  );
}

export function CertaintyBadge({ certainty }: { certainty?: Certainty }) {
  return certainty ? <ChanceBadge label={RELIABILITY[certainty]} /> : null;
}

// ---------------------------------------------------------------------------
// Chips, sheet, misc
// ---------------------------------------------------------------------------
export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  const cls = `chip ${active ? "chip-active" : ""} ${onClick ? "chip-btn" : ""}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={active}>{children}</button>
    : <span className={cls}>{children}</span>;
}

export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  return (
    <div className={`sheet-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sheet-head">
          <h2>{title}</h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={22} /></button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>;
}

export function RowLink({ icon, children, onClick }: { icon: string; children: ReactNode; onClick: () => void }) {
  return (
    <button className="row-link" onClick={onClick}>
      <Icon name={icon} size={20} />
      <span>{children}</span>
      <Icon name="chevron" size={18} />
    </button>
  );
}
