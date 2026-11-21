// Overview: one tile per category (fastest, nearby, comfort, wait), each opens a ranked list.
import { useEffect, useState } from "react";
import { getAlternatives } from "../api/client";
import type { AlternativeCategory, AlternativesResponse, Preferences } from "../types";

const LABELS: Record<AlternativeCategory, string> = {
  fastest: "Fastest arrival",
  nearby: "Close to destination",
  comfort: "Most comfortable",
  wait: "Wait for reopening",
};

interface Props { journeyId: string; preferences: Preferences; onOpenCategory: (c: AlternativeCategory) => void }

export default function Alternatives({ journeyId, preferences, onOpenCategory }: Props) {
  const [data, setData] = useState<AlternativesResponse | null>(null);

  useEffect(() => {
    getAlternatives(journeyId, preferences).then(setData);
  }, [journeyId, preferences]);

  if (!data) return <div className="card">Searching alternatives…</div>;

  return (
    <>
      {(Object.keys(LABELS) as AlternativeCategory[]).map((c) => (
        <div key={c} className="card" onClick={() => onOpenCategory(c)}>
          <strong>{LABELS[c]}</strong>
          <div>{data.by_category[c]?.length ?? 0} option(s)</div>
        </div>
      ))}
    </>
  );
}
