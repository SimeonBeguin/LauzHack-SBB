// "Need help": built for a tired, stressed traveller.
// 1. My journey and what is happening, in one sentence.
// 2. One question: when do you need to be there?
// 3. One clear answer (our advice), with a plain-word chance to make it.
// 4. Two or three other options. Everything else is one tap away.
import { useStore } from "../store";
import type { Alternative, DisruptionStatus, Journey } from "../types";
import { atTime, durationLabel, hhmm, minutesBetween } from "../lib/format";
import { DELAY_DAY } from "../mocks/scenario";
import { otherOptions, rankedOptions } from "../mocks/applyPreferences";
import { ChanceBadge, Chip, ConnectionCard, Header, Icon, labelFor, LineBadge, PillRow, SectionTitle } from "../components/ui";
import { preferencesSummary } from "./PersonaliseSheet";

const DEADLINES = ["19:00", "19:30", "20:00"];

function JourneySummary({ j, status }: { j: Journey; status: DisruptionStatus }) {
  const resolved = status.kind === "resolved";
  return (
    <section className="card summary">
      <h2 className="summary-title">{j.origin.name} <span className="arrow">→</span> {j.destination.name}</h2>
      <div className={`timeline ${resolved ? "" : "cancelled"}`}>
        <LineBadge line={j.line} mode="train" />
        <strong>{hhmm(j.departure)}</strong>
        <span className="tl-track" aria-hidden="true" />
        <strong>{hhmm(j.arrival)}</strong>
      </div>
      <p className={resolved ? "summary-sub" : "summary-sub red"}>
        Today, {durationLabel(minutesBetween(j.departure, j.arrival))} · {resolved ? "running again" : "this train does not run"}
      </p>
    </section>
  );
}

function StatusCard({ status, onMore }: { status: DisruptionStatus; onMore: () => void }) {
  const e = status.estimate;
  if (status.kind === "resolved") {
    return (
      <section className="card status-card ok">
        <Icon name="check" size={26} />
        <div>
          <strong>Trains are running again</strong>
          <p>The line reopened at {hhmm(e.official_end)}. Some trains may still be a few minutes late.</p>
        </div>
      </section>
    );
  }
  const atOfficial = e.probabilities?.find((p) => p.time === e.official_end);
  return (
    <section className="card status-card">
      <Icon name="alert" size={26} />
      <div>
        <strong>No trains between {status.affected_section?.split(" and ")[0]}</strong>
        <p>{status.reason}. SBB expects trains again <b>{e.official_label} {hhmm(e.official_end)}</b>.</p>
        {atOfficial && atOfficial.probability_ended < 0.5 && (
          <p className="muted">Often it takes longer: in similar cases, {Math.round((1 - atOfficial.probability_ended) * 10)} out of 10 reopened later.</p>
        )}
        <button className="link" onClick={onMore}>Why and how long? <Icon name="chevron" size={16} /></button>
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

function Advice({ alt, deadline, onOpen }: { alt: Alternative; deadline: string | null; onOpen: () => void }) {
  const late = deadline && alt.on_time_probability != null && alt.on_time_probability < 0.3;
  return (
    <ConnectionCard alt={alt} deadline={deadline} onOpen={onOpen} highlight noTab>
      <span className="advice-extra">
        <ChanceBadge big label={labelFor(alt)} suffix={deadline ? `to arrive by ${hhmm(deadline)}` : undefined} />
        <span className="muted">{alt.certainty_reason}.</span>
        {late && <span className="warn-line">No option gets you there by {hhmm(deadline)}. This is the earliest you can arrive.</span>}
      </span>
    </ConnectionCard>
  );
}

export default function DisruptionMode() {
  const { status, alternatives, back, push, prefs, setSheetOpen, loading } = useStore();
  if (!status || !alternatives) return <Header title="Need help" onBack={back} />;

  const j = status.journey;
  const advice = rankedOptions(alternatives, prefs)[0] ?? null;
  const others = otherOptions(alternatives, prefs, advice);
  const change = status.changes?.[0];
  const open = (a: Alternative) => push({ name: "connection", id: a.id });

  return (
    <>
      <Header title="Need help" onBack={back} />
      <div className={`content overlap ${loading ? "is-loading" : ""}`}>
        {j && <JourneySummary j={j} status={status} />}

        {change && <div className="card update-card" aria-live="polite"><Icon name="info" size={20} /><span><b>Update {hhmm(status.last_update)}</b> {change}</span></div>}

        <StatusCard status={status} onMore={() => push({ name: "details" })} />

        <DeadlineQuestion destination={j?.destination.name ?? "your destination"} />

        {advice && (
          <>
            <SectionTitle>Our advice</SectionTitle>
            <Advice alt={advice} deadline={prefs.deadline} onOpen={() => open(advice)} />
          </>
        )}

        {others.length > 0 && (
          <>
            <SectionTitle>Other options</SectionTitle>
            {others.map((a) => <ConnectionCard key={a.id} alt={a} deadline={prefs.deadline} onOpen={() => open(a)} />)}
          </>
        )}

        <div className="pill-stack">
          <PillRow icon="plan" onClick={() => push({ name: "list", category: "fastest" })}>See all connections</PillRow>
          <PillRow icon="filter" onClick={() => setSheetOpen(true)}>
            Preferences <span className="pill-sub">{preferencesSummary(prefs)}</span>
          </PillRow>
        </div>

        <p className="ticket-line"><Icon name="ticket" size={18} /> Your ticket is valid on these routes.</p>
      </div>
    </>
  );
}
