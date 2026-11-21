// Screen 1 of the mockup: "Need help". What is going on, how long it will
// probably last, our advice, and the four option categories.
import { useStore } from "../store";
import type { Alternative, AlternativeCategory } from "../types";
import { hhmm, relativeLabel } from "../lib/format";
import { CATEGORIES, CATEGORY_META, eyebrow } from "../lib/categories";
import { pickAdvice } from "../mocks/applyPreferences";
import EstimateCard from "../components/EstimateCard";
import { arrivalLabel } from "../components/AlternativeCard";
import { CertaintyBadge, Header, Icon, SectionTitle } from "../components/ui";
import { preferencesSummary } from "./PersonaliseSheet";

function CategoryTile({ category, best, count, onOpen }: { category: AlternativeCategory; best?: Alternative; count: number; onOpen: () => void }) {
  const { prefs } = useStore();
  const meta = CATEGORY_META[category];
  return (
    <button className={`card tile tile-${category}`} onClick={onOpen}>
      <span className="tile-icon"><Icon name={meta.icon} size={22} /></span>
      <span className="tile-body">
        <span className="eyebrow">{eyebrow(category, prefs)}</span>
        {best ? (
          <>
            <strong>{best.title}</strong>
            <span className="muted small">
              {best.transfers === 0 ? "Direct" : `${best.transfers} transfer${best.transfers > 1 ? "s" : ""}`}
              {best.distance_to_destination_km > 0 ? ` · ${best.distance_to_destination_km} km away` : ""}
            </span>
            <CertaintyBadge certainty={best.certainty} compact />
          </>
        ) : (
          <span className="muted small">No option matches your answers</span>
        )}
      </span>
      <span className="tile-time">
        {best && <strong className={best.arrival_latest ? "range" : ""}>{arrivalLabel(best)}</strong>}
        <span className="muted small">{count > 1 ? `${count} options` : ""}</span>
      </span>
      <Icon name="chevron" size={18} className="tile-chevron" />
    </button>
  );
}

export default function DisruptionMode() {
  const { status, alternatives, back, push, prefs, setSheetOpen, clock, loading } = useStore();
  if (!status || !alternatives) return <div className="content"><div className="card">Loading…</div></div>;

  const j = status.journey;
  const advice = pickAdvice(alternatives);
  const resolved = status.kind === "resolved";

  return (
    <>
      <Header
        title="Need help"
        subtitle={j ? `${j.origin.name} → ${j.destination.name} · ${j.line} at ${hhmm(j.departure)}` : undefined}
        onBack={back}
      />
      <div className={`content ${loading ? "is-loading" : ""}`}>
        <section className={`card incident ${resolved ? "resolved" : ""}`}>
          <Icon name={resolved ? "check" : "alert"} size={24} className="incident-icon" />
          <div className="incident-body">
            <strong>{status.title}</strong>
            <div>{status.reason}{status.started_at ? ` · since ${hhmm(status.started_at)}` : ""}</div>
            <div className="muted small">Last SBB update {relativeLabel(status.last_update, clock)} ({hhmm(status.last_update)})</div>
          </div>
          <button className="link" onClick={() => push({ name: "details" })}>Details</button>
        </section>

        {status.changes && status.changes.length > 0 && (
          <section className="changes" aria-live="polite">
            <strong>What changed</strong>
            <ul>{status.changes.map((c) => <li key={c}>{c}</li>)}</ul>
          </section>
        )}

        <EstimateCard status={status} now={clock} />

        {advice && (
          <section className="card advice">
            <div className="eyebrow red"><Icon name="star" size={12} /> Our advice</div>
            <div className="advice-main">
              <div>
                <strong className="advice-title">{advice.title}</strong>
                <div className="muted small">Leave {hhmm(advice.departure)} · {advice.subtitle}</div>
              </div>
              <div className="advice-time">
                <strong>{arrivalLabel(advice)}</strong>
                <span className="muted small">arrival</span>
              </div>
            </div>
            <div className="advice-why">
              <CertaintyBadge certainty={advice.certainty} compact />
              <span>{advice.certainty_reason}</span>
            </div>
            <button className="btn btn-primary" onClick={() => push({ name: "list", category: advice.category })}>
              See this route
            </button>
          </section>
        )}

        <button className="personalise-btn" onClick={() => setSheetOpen(true)}>
          <Icon name="sliders" size={20} />
          <strong>Personalise</strong>
          <span className="muted small">{preferencesSummary(prefs)}</span>
          <Icon name="chevron" size={18} />
        </button>

        <SectionTitle>Your options</SectionTitle>
        {CATEGORIES.map((c) => {
          const list = alternatives.by_category[c] ?? [];
          const enabled = list.filter((a) => !a.disabled_reason);
          return (
            <CategoryTile key={c} category={c} best={enabled[0]} count={enabled.length}
              onOpen={() => push({ name: "list", category: c })} />
          );
        })}
        <p className="fineprint center">The SBB timetable stays the official source. Options are re-ranked at every SBB update.</p>
      </div>
    </>
  );
}
