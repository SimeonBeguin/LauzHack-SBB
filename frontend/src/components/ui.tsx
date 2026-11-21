// Small shared UI pieces: icons, header, chips, certainty badge, leg bar, sheet.
import type { ReactNode } from "react";
import type { Certainty, Leg } from "../types";
import { minutesBetween } from "../lib/format";

// ---------------------------------------------------------------------------
// Icons (inline SVG, inherit currentColor)
// ---------------------------------------------------------------------------
const paths: Record<string, ReactNode> = {
  back: <path d="M15 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  alert: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M12 7v6M12 16.5v.5" stroke="#fff" strokeWidth="2.4" /></>,
  check: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  bolt: <path d="M13 3L5 14h6l-1 7 8-11h-6z" />,
  target: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="3" /></>,
  cup: <><path d="M5 9h11v5a5 5 0 0 1-5 5h-1a5 5 0 0 1-5-5z" /><path d="M16 10h1.5a2.5 2.5 0 0 1 0 5H16M8 3v3M11 3v3" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  sliders: <><path d="M4 7h10M18 7h2M4 17h4M12 17h8" /><circle cx="16" cy="7" r="2" /><circle cx="10" cy="17" r="2" /></>,
  train: <><rect x="6" y="3" width="12" height="14" rx="3" /><path d="M6 11h12M9 21l1.5-4M15 21l-1.5-4" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  star: <path d="M12 4l2.4 5 5.4.6-4 3.7 1.1 5.4L12 16l-4.9 2.7 1.1-5.4-4-3.7 5.4-.6z" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  ticket: <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" />,
};

export function Icon({ name, size = 20, className }: { name: keyof typeof paths | string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------
export function Header({ title, subtitle, onBack, right }: { title: string; subtitle?: string; onBack?: () => void; right?: ReactNode }) {
  return (
    <header className="app-header">
      {onBack && (
        <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={24} /></button>
      )}
      <div className="app-header-text">
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {right}
    </header>
  );
}

// ---------------------------------------------------------------------------
// Chips and badges
// ---------------------------------------------------------------------------
export function Chip({ children, active, onClick, tone }: { children: ReactNode; active?: boolean; onClick?: () => void; tone?: "warn" | "ok" | "muted" }) {
  const cls = `chip ${active ? "chip-active" : ""} ${tone ? `chip-${tone}` : ""} ${onClick ? "chip-btn" : ""}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={active}>{children}</button>
    : <span className={cls}>{children}</span>;
}

export const CERTAINTY_LABEL: Record<Certainty, string> = { safe: "Safe", likely: "Likely", uncertain: "Uncertain" };

export function CertaintyBadge({ certainty, reason, compact }: { certainty?: Certainty; reason?: string; compact?: boolean }) {
  if (!certainty) return null;
  return (
    <span className={`certainty certainty-${certainty}`} title={reason}>
      <span className="dot" aria-hidden="true" />
      {CERTAINTY_LABEL[certainty]}{!compact && reason ? ` · ${reason}` : ""}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Leg bar: one segment per leg, width proportional to duration, gap = transfer
// ---------------------------------------------------------------------------
export function LegBar({ legs }: { legs: Leg[] }) {
  if (!legs.length) return null;
  const start = legs[0].departure;
  const end = legs[legs.length - 1].arrival;
  const total = Math.max(1, minutesBetween(start, end));
  const parts: { kind: string; min: number; label: string }[] = [];
  legs.forEach((l, i) => {
    if (i > 0) {
      const gap = minutesBetween(legs[i - 1].arrival, l.departure);
      if (gap > 0) parts.push({ kind: "transfer", min: gap, label: `Transfer ${gap} min` });
    }
    parts.push({ kind: l.mode, min: Math.max(1, minutesBetween(l.departure, l.arrival)), label: `${l.line ?? l.mode} ${l.from_stop.name} → ${l.to_stop.name}` });
  });
  return (
    <div className="legbar" role="img" aria-label={parts.map((p) => p.label).join(", ")}>
      {parts.map((p, i) => (
        <span key={i} className={`seg seg-${p.kind}`} style={{ flexGrow: Math.max(p.min / total, 0.04) }} title={p.label} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom sheet (positioned inside the phone)
// ---------------------------------------------------------------------------
export function BottomSheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  return (
    <div className={`sheet-layer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="sheet-backdrop" onClick={onClose} />
      <div className="sheet" role="dialog" aria-modal="true">
        <div className="sheet-handle" />
        {children}
      </div>
    </div>
  );
}

export function SectionTitle({ children }: { children: ReactNode }) {
  return <h2 className="section-title">{children}</h2>;
}
