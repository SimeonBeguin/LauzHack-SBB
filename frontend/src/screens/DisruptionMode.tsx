// "Need help": built for a tired, stressed traveller. Three blocks only:
// 1. My journey and that it does not run, with a "Details" button (incident,
//    how long it may last, chances): everything else lives on that page.
// 2. Our advice: one itinerary, picked without asking anything. After the
//    "Personalize" questions, it is the one picked for this traveller
//    (lib/personalize.ts), with the reasons.
// 3. Personalize my trip (3 questions), and "See all connections" for the rest.
import { useEffect, useRef } from "react";
import { useStore } from "../store";
import type { Alternative, DisruptionStatus, Journey } from "../types";
import { hhmm } from "../lib/format";
import { rankedOptions } from "../lib/ranking";
import { Header, Icon, LineBadge, PillRow } from "../components/ui";
import AdviceCard from "../components/AdviceCard";
import { answersOf, answersSummary, personalPick } from "../lib/personalize";
import { focusBestOption } from "./Personalize";

function JourneySummary({ j, status, onDetails }: { j: Journey; status: DisruptionStatus; onDetails: () => void }) {
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
        {resolved ? "Running again" : "This train does not run"}
      </p>
      <button className="btn btn-secondary details-btn" onClick={onDetails}>
        Details <Icon name="chevron" size={16} />
      </button>
    </section>
  );
}

export default function DisruptionMode() {
  const { status, alternatives, back, push, prefs, loading } = useStore();
  const answers = answersOf(prefs);
  const bestRef = useRef<HTMLHeadingElement | null>(null);
  const ready = !!status && !!alternatives && !loading;
  // Back from the Personalize questions: show the chosen itinerary right away.
  useEffect(() => {
    if (!ready || !focusBestOption.current || !bestRef.current) return;
    focusBestOption.current = false;
    bestRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [ready]);
  if (!status || !alternatives) return <Header title="Need help" onBack={back} />;

  const j = status.journey;
  // Without answers: the default advice. With them: the itinerary picked for this traveller.
  const pick = answers ? personalPick(alternatives, prefs, status, answers) : null;
  const advice = pick?.alt ?? rankedOptions(alternatives, prefs)[0] ?? null;
  const open = (a: Alternative) => push({ name: "connection", id: a.id });

  return (
    <>
      <Header title="Need help" onBack={back} />
      <div className={`content overlap ${loading ? "is-loading" : ""}`}>
        {/* 1. Infos */}
        {j && <JourneySummary j={j} status={status} onDetails={() => push({ name: "details" })} />}

        {/* 2. Our advice */}
        {advice && (
          <>
            <h2 className="section-title pz-anchor" ref={bestRef}>{pick ? "Best for you" : "Our advice"}</h2>
            <AdviceCard alt={advice} deadline={prefs.deadline} onOpen={() => open(advice)} pick={pick} />
          </>
        )}

        {/* 3. Personalize, and everything else */}
        <button className="btn btn-primary perso" onClick={() => push({ name: "personalize" })}>
          <Icon name="filter" size={26} />
          <span className="perso-text">
            <span>{answers ? "Change my answers" : "Personalize my trip"}</span>
            <small>{answers ? `Based on: ${answersSummary(answers)}` : "3 quick questions for the best option for you"}</small>
          </span>
          <Icon name="chevron" size={20} />
        </button>
        <div className="pill-stack">
          <PillRow icon="plan" onClick={() => push({ name: "list", category: "fastest" })}>See all connections</PillRow>
        </div>

        <p className="ticket-line"><Icon name="ticket" size={18} /> Your ticket is valid on these routes.</p>
      </div>
    </>
  );
}
