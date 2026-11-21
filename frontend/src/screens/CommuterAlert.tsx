// Opened from a commuter notification: how likely my own train is hit, why,
// what is happening on my line, and what I can do.
import { useStore } from "../store";
import { COMMUTER_ALERTS, COMMUTER_TRIP } from "../mocks/scenario";
import { hhmm, pct } from "../lib/format";
import { CertaintyBadge, Header, Icon, SectionTitle } from "../components/ui";

const KIND_LABEL = {
  earlier_train: "Early warning · an earlier train is hit",
  own_train: "Your train is affected",
  resolved: "All clear",
};

const STATE_LABEL = { stuck: "Stopped", cancelled: "Cancelled", at_risk: "At risk", ok: "Running" };

function RiskGauge({ p }: { p: number }) {
  const r = 34, c = 2 * Math.PI * r;
  return (
    <svg width="88" height="88" viewBox="0 0 88 88" role="img" aria-label={`${pct(p)} chance`}>
      <circle cx="44" cy="44" r={r} className="gauge-track" />
      <circle cx="44" cy="44" r={r} className="gauge-value" strokeDasharray={`${c * p} ${c}`} transform="rotate(-90 44 44)" />
      <text x="44" y="50" textAnchor="middle" className="gauge-text">{pct(p)}</text>
    </svg>
  );
}

export default function CommuterAlert({ index }: { index: number }) {
  const { back } = useStore();
  const a = COMMUTER_ALERTS[index];
  const n = a.notification;
  const trip = COMMUTER_TRIP;
  const resolved = n.kind === "resolved";

  return (
    <>
      <Header
        title={`Your ${trip.departure_time} to ${trip.destination_name?.split("/")[0]}`}
        subtitle={`${trip.line} · ${trip.origin_name} → ${trip.destination_name} · alert at ${hhmm(n.created_at)}`}
        onBack={back}
      />
      <div className="content">
        <section className={`card risk ${resolved ? "resolved" : ""}`}>
          <div className={`eyebrow ${resolved ? "green" : "red"}`}>{n.kind ? KIND_LABEL[n.kind] : ""}</div>
          <div className="risk-main">
            {n.probability != null ? <RiskGauge p={n.probability} /> : <Icon name="check" size={56} className="ok-icon" />}
            <div>
              <strong className="risk-headline">{a.headline}</strong>
              {n.probability != null && (
                <div className="muted small">{pct(n.probability)} chance your {trip.departure_time} is still disrupted when it should leave.</div>
              )}
            </div>
          </div>
          <ul className="reasons">{a.reasons.map((r) => <li key={r}>{r}</li>)}</ul>
        </section>

        <SectionTitle>Trains on your line</SectionTitle>
        <ol className="card line-timeline">
          {a.line.map((tr) => (
            <li key={tr.time + tr.train} className={`lt lt-${tr.state} ${tr.yours ? "yours" : ""}`}>
              <span className="lt-time">{hhmm(tr.time)}</span>
              <span className="lt-dot" aria-hidden="true" />
              <span className="lt-body">
                <strong>{tr.train}{tr.yours ? " · your train" : ""}</strong>
                <span className="muted small">{STATE_LABEL[tr.state]}{tr.note ? ` · ${tr.note}` : ""}</span>
              </span>
            </li>
          ))}
        </ol>

        {a.options.length > 0 && <SectionTitle>What you can do</SectionTitle>}
        {a.options.map((o) => (
          <article key={o.title} className={`card alt-card ${o.recommended ? "recommended" : ""}`}>
            {o.recommended && <div className="eyebrow red"><Icon name="star" size={12} /> Our advice</div>}
            <div className="alt-top">
              <div>
                <h3>{o.title}</h3>
                <div className="muted small">Leave {hhmm(o.departure)} · {o.detail}</div>
              </div>
              <div className="alt-time">{hhmm(o.arrival)}</div>
            </div>
            <div className="chips"><CertaintyBadge certainty={o.certainty} reason={o.reason} /></div>
          </article>
        ))}

        {a.footer && <section className="card ok-note"><Icon name="check" size={18} className="ok-icon" /> {a.footer}</section>}
        <p className="fineprint"><Icon name="info" size={14} /> Estimate, not a guarantee. The SBB timetable stays the official source.</p>
      </div>
    </>
  );
}
