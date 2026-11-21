// "Need help": built for a tired, stressed traveller.
// 1. What is happening, in one sentence.
// 2. One question: when do you need to be there?
// 3. One clear answer (our advice), with a plain-word chance to make it.
// 4. Two or three other options, one line each. Everything else is one tap away.
import { useStore } from "../store";
import type { Alternative, DisruptionStatus } from "../types";
import { atTime, hhmm } from "../lib/format";
import { DELAY_DAY } from "../mocks/scenario";
import { otherOptions, rankedOptions } from "../mocks/applyPreferences";
import { ChanceBadge, Chip, ConnectionLine, Header, Icon, labelFor, LineBadges, RowLink, SectionTitle } from "../components/ui";
import { preferencesSummary } from "./PersonaliseSheet";

const DEADLINES = ["19:00", "19:30", "20:00"];

function StatusBox({ status, onMore }: { status: DisruptionStatus; onMore: () => void }) {
  const e = status.estimate;
  if (status.kind === "resolved") {
    return (
      <section className="status-box ok">
        <Icon name="check" size={22} />
        <div>
          <strong>Trains are running again</strong>
          <p>The line reopened at {hhmm(e.official_end)}. Some trains may still be a few minutes late.</p>
        </div>
      </section>
    );
  }
  const atOfficial = e.probabilities?.find((p) => p.before === e.official_end);
  return (
    <section className="status-box">
      <Icon name="alert" size={22} />
      <div>
        <strong>No trains between {status.affected_section?.split(" and ")[0]}</strong>
        <p>{status.reason}. SBB expects trains again <b>{e.official_label} {hhmm(e.official_end)}</b>.</p>
        {atOfficial && atOfficial.p < 0.5 && (
          <p className="hint">Often it takes longer: in similar cases, {Math.round((1 - atOfficial.p) * 10)} out of 10 reopened later.</p>
        )}
        <button className="link" onClick={onMore}>Why and how long? <Icon name="chevron" size={14} /></button>
      </div>
    </section>
  );
}

function DeadlineQuestion({ destination }: { destination: string }) {
  const { prefs, setPrefs } = useStore();
  const current = prefs.deadline ? hhmm(prefs.deadline) : null;
  const isOther = current != null && !DEADLINES.includes(current);
  const set = (hm: string | null) => setPrefs({ ...prefs, deadline: hm ? atTime(DELAY_DAY, hm) : null });

  return (
    <section className="card question">
      <h2>When do you need to be in {destination}?</h2>
      <div className="chips">
        <Chip active={!current} onClick={() => set(null)}>As soon as possible</Chip>
        {DEADLINES.map((d) => <Chip key={d} active={current === d} onClick={() => set(d)}>By {d}</Chip>)}
        <label className={`chip chip-btn ${isOther ? "chip-active" : ""}`}>
          {isOther ? `By ${current}` : "Other time"}
          <input type="time" aria-label="Other time" value={isOther ? current! : ""}
            onChange={(e) => e.target.value && set(e.target.value)} />
        </label>
      </div>
    </section>
  );
}

function AdviceCard({ alt, deadline, onOpen }: { alt: Alternative; deadline: string | null; onOpen: () => void }) {
  const label = labelFor(alt);
  const late = deadline && alt.on_time_probability != null && alt.on_time_probability < 0.3;
  return (
    <section className="card advice">
      <div className="advice-eyebrow">Our advice</div>
      <h2 className="advice-title">{alt.title}</h2>
      <ConnectionLine alt={alt} />
      <div className="advice-meta">
        <LineBadges legs={alt.legs} />
      </div>
      <div className="advice-chance">
        <ChanceBadge big label={label} suffix={deadline ? `to arrive by ${hhmm(deadline)}` : undefined} />
        <p className="muted">{alt.certainty_reason}.</p>
      </div>
      {late && <p className="warn-line">No option gets you there by {hhmm(deadline)}. This is the earliest you can arrive.</p>}
      <button className="btn btn-primary" onClick={onOpen}>Show connection</button>
    </section>
  );
}

function OptionRow({ alt, onOpen }: { alt: Alternative; onOpen: () => void }) {
  return (
    <button className="option-row" onClick={onOpen}>
      <span className="option-text">
        <strong>{alt.title}</strong>
        <span className="muted small">
          Arrive {alt.arrival_latest ? `${hhmm(alt.arrival)} or later` : hhmm(alt.arrival)}
        </span>
        <ChanceBadge label={labelFor(alt)} />
      </span>
      <Icon name="chevron" size={18} className="muted" />
    </button>
  );
}

export default function DisruptionMode() {
  const { status, alternatives, back, push, prefs, setSheetOpen, loading } = useStore();
  if (!status || !alternatives) return <div className="content"><div className="card">Loading…</div></div>;

  const j = status.journey;
  const advice = rankedOptions(alternatives, prefs)[0] ?? null;
  const others = otherOptions(alternatives, prefs, advice);
  const change = status.changes?.[0];

  return (
    <>
      <Header title="Help with your journey" subtitle={j ? `${j.origin.name} → ${j.destination.name}, ${j.line} ${hhmm(j.departure)}` : undefined} onBack={back} />
      <div className={`content ${loading ? "is-loading" : ""}`}>
        {change && <div className="update-line" aria-live="polite"><Icon name="info" size={16} /> Update {hhmm(status.last_update)}: {change}</div>}

        <StatusBox status={status} onMore={() => push({ name: "details" })} />

        <DeadlineQuestion destination={j?.destination.name ?? "your destination"} />

        {advice && <AdviceCard alt={advice} deadline={prefs.deadline} onOpen={() => push({ name: "list", category: advice.category })} />}

        {others.length > 0 && (
          <>
            <SectionTitle>Other options</SectionTitle>
            <div className="card list-card">
              {others.map((a) => (
                <OptionRow key={a.id} alt={a} onOpen={() => push({ name: "list", category: a.category })} />
              ))}
            </div>
          </>
        )}

        <div className="card list-card">
          <RowLink icon="timetable" onClick={() => push({ name: "list", category: "fastest" })}>See all connections</RowLink>
          <RowLink icon="sliders" onClick={() => setSheetOpen(true)}>
            Preferences <span className="muted small">{preferencesSummary(prefs)}</span>
          </RowLink>
        </div>

        <p className="ticket-line"><Icon name="ticket" size={16} /> Your ticket is valid on these routes.</p>
      </div>
    </>
  );
}
