// Shared UI pieces, matching the SBB Mobile app: red top bar with a centred
// light title, white rounded cards overlapping it, connection lines with dots,
// grey pill rows with a chevron, red pill buttons.
import type { ReactNode } from "react";
import type { Alternative, Certainty, Leg } from "../types";
import { durationLabel, hhmm, minutesBetween } from "../lib/format";
import { chanceLabel, gaugeOf, RELIABILITY, reliabilityLabel, type ChanceLabel } from "../lib/chance";

// ---------------------------------------------------------------------------
// Icons (inline SVG, inherit currentColor)
// ---------------------------------------------------------------------------
const paths: Record<string, ReactNode> = {
  back: <path d="M20 12H4M10 5l-7 7 7 7" />,
  chevron: <path d="M9 5l7 7-7 7" />,
  down: <path d="M5 9l7 7 7-7" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  alert: <><path d="M12 3l10 18H2z" fill="currentColor" stroke="none" /><path d="M12 10v5M12 17.6v.4" stroke="#fff" strokeWidth="2.2" /></>,
  check: <><circle cx="12" cy="12" r="10" fill="currentColor" stroke="none" /><path d="M7.5 12.5l3 3 6-6.5" stroke="#fff" strokeWidth="2.2" /></>,
  info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8v.5" /></>,
  bell: <><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15z" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
  filter: <><path d="M3 7h18M3 17h18" /><circle cx="9" cy="7" r="2.2" fill="#fff" /><circle cx="15" cy="17" r="2.2" fill="#fff" /><path d="M3 12h18" /><circle cx="17" cy="12" r="2.2" fill="#fff" /></>,
  plus: <path d="M12 5v14M5 12h14" />,
  lock: <><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
  ticket: <path d="M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4z" />,
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.8-5.2 2.8 1-5.8-4.3-4.1 5.9-.9z" />,
  map: <><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z" /><path d="M9 4v14M15 6v14" /></>,
  more: <><circle cx="12" cy="5" r="1.6" fill="currentColor" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><circle cx="12" cy="19" r="1.6" fill="currentColor" /></>,
  swap: <path d="M8 4v16M8 4L4 8M8 4l4 4M16 20V4M16 20l-4-4M16 20l4-4" />,
  history: <><path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" /><path d="M3 3v4h4M12 8v4l3 2" /></>,
  walk: <><circle cx="13" cy="4" r="1.8" fill="currentColor" stroke="none" /><path d="M10 21l2.5-6 2.5 2v4M12.5 15l-1-5 3 3h3M11.5 10l-3 2-1 3" /></>,
  pencil: <path d="M4 20l1-4L16 5l3 3L8 19zM14 7l3 3" />,
  // tab bar
  plan: <><path d="M3 5h8M3 9h8M3 13h5M3 17h5" /><circle cx="16" cy="15" r="5" /><path d="M16 12.5V15l1.6 1" /></>,
  trips: <><rect x="5" y="4" width="14" height="13" rx="3" /><path d="M5 11h14M8 20l1.5-3M16 20l-1.5-3M9 7.5h6" /><circle cx="8.5" cy="14" r=".8" fill="currentColor" /><circle cx="15.5" cy="14" r=".8" fill="currentColor" /></>,
  toggle: <><rect x="2.5" y="7.5" width="19" height="9" rx="4.5" /><circle cx="7.5" cy="12" r="2.5" /></>,
  qr: <><rect x="4" y="4" width="6" height="6" /><rect x="14" y="4" width="6" height="6" /><rect x="4" y="14" width="6" height="6" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" /></>,
  shop: <><path d="M4 9l1.5-5h13L20 9" /><rect x="4" y="9" width="16" height="11" rx="2" /><path d="M9 14.5h6M10.5 13l-1.5 1.5 1.5 1.5M13.5 13l1.5 1.5-1.5 1.5" /></>,
  user: <><circle cx="12" cy="12" r="9.5" /><circle cx="12" cy="10" r="3.2" /><path d="M6 18.5a7 7 0 0 1 12 0" /></>,
  train: <><rect x="6" y="3" width="12" height="14" rx="3" /><path d="M6 10h12M9 21l1.5-4M15 21l-1.5-4" /></>,
  bus: <><rect x="5" y="3" width="14" height="15" rx="3" /><path d="M5 10h14M8 21v-3M16 21v-3" /></>,
  target: <><circle cx="12" cy="12" r="5" /><circle cx="12" cy="12" r="1.6" fill="currentColor" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></>,
  ring: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /></>,
  // personalize answers
  "check-plain": <path d="M5 12.5l4.5 4.5L19 7.5" />,
  car: <><path d="M4 16.5V12l2.2-5h11.6l2.2 5v4.5z" /><path d="M4 12h16" /><circle cx="7.5" cy="16.5" r="1.8" fill="#fff" /><circle cx="16.5" cy="16.5" r="1.8" fill="#fff" /></>,
  luggage: <><rect x="6" y="7" width="12" height="13" rx="2" /><path d="M9.5 7V4h5v3M10 11v5M14 11v5" /></>,
  bike: <><circle cx="6" cy="16" r="3.5" /><circle cx="18" cy="16" r="3.5" /><path d="M6 16l4-7h5l3 7M10 9l3.5 7M8.5 6h3" /></>,
  wheelchair: <><circle cx="11" cy="4.5" r="1.6" fill="currentColor" stroke="none" /><path d="M11 7v6h5l2 5" /><path d="M8.5 10.5a5.5 5.5 0 1 0 6.8 7.3" /></>,
};

export function Icon({ name, size = 20, className }: { name: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

/** Generic double-arrow brand mark (top right of the red bar). */
function BrandMark() {
  return (
    <svg width="40" height="22" viewBox="0 0 40 22" aria-hidden="true" fill="#fff">
      <path d="M10 0h6l-7 8h9V0h4v8h9l-7-8h6l9 11-9 11h-6l7-8h-9v8h-4v-8H9l7 8h-6L1 11z" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Red top bar
// ---------------------------------------------------------------------------
export function Header({ title, onBack, right, children }: {
  title: string; onBack?: () => void; right?: ReactNode; children?: ReactNode;
}) {
  return (
    <>
    <header className="app-header">
      <div className={`app-header-row ${right ? "has-action" : ""}`}>
        <span className="hdr-side">
          {onBack && <button className="icon-btn" onClick={onBack} aria-label="Back"><Icon name="back" size={28} /></button>}
        </span>
        <h1>{title}</h1>
        <span className="hdr-side right">{right ?? <BrandMark />}</span>
      </div>
      {children}
    </header>
    {/* red band behind the first card, scrolls away under the sticky bar */}
    <div className="hdr-band" aria-hidden="true" />
    </>
  );
}

// ---------------------------------------------------------------------------
// Line pictograms
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
// Timeline row: 17:15 ●──────○──────● 18:40 (hollow dots = changes)
// ---------------------------------------------------------------------------
export function TimeLine({ legs, arrival, arrivalLate }: { legs: Leg[]; arrival?: string; arrivalLate?: boolean }) {
  const moving = legs.filter((l) => l.mode !== "wait");
  const first = moving[0] ?? legs[0];
  const last = legs[legs.length - 1];
  const t0 = new Date(first.departure).getTime();
  const total = Math.max(1, new Date(last.arrival).getTime() - t0);
  const changes = moving.slice(1).map((l) => ((new Date(l.departure).getTime() - t0) / total) * 100);
  return (
    <div className="timeline">
      <strong>{hhmm(first.departure)}</strong>
      <span className="tl-track" aria-hidden="true">
        {changes.map((x, i) => <i key={i} className="tl-change" style={{ left: `${Math.min(92, Math.max(8, x))}%` }} />)}
      </span>
      <strong className={arrivalLate ? "late" : ""}>{arrival ?? hhmm(last.arrival)}</strong>
    </div>
  );
}

export function tripMinutes(a: Alternative): number {
  const first = a.legs.find((l) => l.mode !== "wait") ?? a.legs[0];
  return minutesBetween(first.departure, a.legs[a.legs.length - 1].arrival);
}

// ---------------------------------------------------------------------------
// Chance: one word + colour + "x in 10"
// ---------------------------------------------------------------------------
export function labelFor(
  alt: Pick<Alternative, "on_time_probability" | "certainty" | "reliability" | "uses_blocked_line">,
): ChanceLabel | null {
  if (alt.on_time_probability != null) return chanceLabel(alt.on_time_probability);
  const gauge = gaugeOf(alt);
  if (gauge) return reliabilityLabel(gauge);
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

/** Slanted tab in the top-right corner of a connection card (like the price tab). */
export function ChanceTab({ label, prefix }: { label: ChanceLabel | null; prefix?: string }) {
  if (!label) return null;
  return (
    <span className={`corner-tab tone-${label.tone}`}>
      <span className="chance-dot" aria-hidden="true" />
      {prefix && <span className="corner-small">{prefix}</span>}
      <strong>{label.word}</strong>
    </span>
  );
}

export function CertaintyBadge({ certainty }: { certainty?: Certainty | null }) {
  return certainty ? <ChanceBadge label={RELIABILITY[certainty]} /> : null;
}

// ---------------------------------------------------------------------------
// Connection card (list item), like the SBB "Connections" screen
// ---------------------------------------------------------------------------
export function ConnectionCard({ alt, deadline, onOpen, tag, highlight, noTab, children }: {
  alt: Alternative; deadline: string | null; onOpen: () => void; tag?: string; highlight?: boolean; noTab?: boolean; children?: ReactNode;
}) {
  const firstRide = alt.legs.find((l) => l.mode !== "wait" && l.mode !== "walk");
  const disabled = !!alt.disabled_reason;
  return (
    <button className={`card conn-card ${disabled ? "disabled" : ""} ${highlight ? "highlight" : ""}`} onClick={onOpen}>
      {!disabled && !noTab && <ChanceTab label={labelFor(alt)} prefix={deadline ? `by ${hhmm(deadline)}` : undefined} />}
      {tag && <span className="conn-tag">{tag}</span>}
      <span className="conn-title">
        {firstRide && <LineBadge line={firstRide.line} mode={firstRide.mode} />}
        <span>{alt.title}</span>
      </span>
      <TimeLine legs={alt.legs} arrival={alt.arrival_latest ? `${hhmm(alt.arrival)}+` : undefined} arrivalLate={!!alt.arrival_latest} />
      <span className="conn-foot">
        <span className="muted">{alt.transfers === 0 ? "Direct" : `${alt.transfers} change${alt.transfers > 1 ? "s" : ""}`}</span>
        <span className="conn-dur">{durationLabel(tripMinutes(alt))}</span>
      </span>
      {!disabled && !noTab && gaugeOf(alt) && <span className="conn-reason muted">{gaugeOf(alt)!.reason}</span>}
      {disabled && <span className="disabled-reason">Not shown: {alt.disabled_reason}</span>}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Chips, pill rows, sheet, misc
// ---------------------------------------------------------------------------
export function Chip({ children, active, onClick }: { children: ReactNode; active?: boolean; onClick?: () => void }) {
  const cls = `chip ${active ? "chip-active" : ""} ${onClick ? "chip-btn" : ""}`;
  return onClick
    ? <button type="button" className={cls} onClick={onClick} aria-pressed={active}>{children}</button>
    : <span className={cls}>{children}</span>;
}

/** Grey rounded row with an icon and a chevron (SBB "Walk: 652 m", "Change", shop items). */
export function PillRow({ icon, lead, children, onClick }: { icon?: string; lead?: ReactNode; children: ReactNode; onClick?: () => void }) {
  return (
    <button className="pill-row" onClick={onClick}>
      {lead && <span className="pill-lead">{lead}</span>}
      {icon && <Icon name={icon} size={24} />}
      <span className="pill-text">{children}</span>
      <Icon name="chevron" size={20} />
    </button>
  );
}

export function CircleButton({ icon, label, onClick, active }: { icon: string; label: string; onClick?: () => void; active?: boolean }) {
  return (
    <button className={`circle-btn ${active ? "active" : ""}`} onClick={onClick} aria-label={label} aria-pressed={active}>
      <Icon name={icon} size={24} />
    </button>
  );
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
