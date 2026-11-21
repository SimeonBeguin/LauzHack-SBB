import { useEffect, useState } from "react";
import { getJourneyStatus } from "../api/client";
import EstimateBanner from "../components/EstimateBanner";
import type { DisruptionStatus } from "../types";

export default function JourneyStatus({ journeyId, onNeedHelp }: { journeyId: string; onNeedHelp: () => void }) {
  const [status, setStatus] = useState<DisruptionStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getJourneyStatus(journeyId).then(setStatus).catch((e) => setError(String(e)));
  }, [journeyId]);

  if (error) return <div className="card">Could not load status: {error}</div>;
  if (!status) return <div className="card">Loading…</div>;

  return (
    <>
      <div className="card">
        <strong>{status.title}</strong>
        <div>{status.reason} · {status.affected_section}</div>
      </div>
      <EstimateBanner estimate={status.estimate} />
      {/* TODO: "Need help" entry point styled like the mockup */}
      <button onClick={onNeedHelp}>Need help? Find alternatives</button>
    </>
  );
}
