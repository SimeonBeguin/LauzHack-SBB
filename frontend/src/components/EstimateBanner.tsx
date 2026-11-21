// Official SBB time is the headline; our statistical range is secondary and never contradicts it.
import type { ReopeningEstimate } from "../types";

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "?");

export default function EstimateBanner({ estimate }: { estimate: ReopeningEstimate }) {
  return (
    <div className="card">
      <div>Official reopening: <strong>{time(estimate.official_end)}</strong></div>
      <small>
        Likely between {time(estimate.likely_end_earliest)} and {time(estimate.likely_end_latest)}
        {" "}({estimate.explanation})
      </small>
    </div>
  );
}
