import { useEffect, useState } from "react";
import { getAlternatives } from "../api/client";
import AlternativeCard from "../components/AlternativeCard";
import type { Alternative, AlternativeCategory, Preferences } from "../types";

interface Props { journeyId: string; preferences: Preferences; category: AlternativeCategory; onBack: () => void }

export default function AlternativeList({ journeyId, preferences, category, onBack }: Props) {
  const [items, setItems] = useState<Alternative[]>([]);

  useEffect(() => {
    // TODO: share the response with the Alternatives screen instead of fetching twice
    getAlternatives(journeyId, preferences).then((r) => setItems(r.by_category[category] ?? []));
  }, [journeyId, preferences, category]);

  return (
    <>
      <button onClick={onBack}>← Back</button>
      {items.map((a) => <AlternativeCard key={a.id} alternative={a} />)}
    </>
  );
}
