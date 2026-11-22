// The "Our advice" / "Best for you" card: one connection, its reliability and why.
// Shared by "Need help" and the commuter / booked-trip alerts so they look the same.
import type { Alternative } from "../types";
import { hhmm } from "../lib/format";
import { gaugeOf, reasonFor } from "../lib/chance";
import type { PersonalPick } from "../lib/personalize";
import { ChanceBadge, ConnectionCard, Icon, labelFor } from "./ui";

export default function AdviceCard({ alt, deadline, onOpen, pick }: {
  alt: Alternative; deadline: string | null; onOpen: () => void; pick?: PersonalPick | null;
}) {
  const late = deadline && alt.on_time_probability != null && alt.on_time_probability < 0.3;
  return (
    <ConnectionCard alt={alt} deadline={deadline} onOpen={onOpen} highlight noTab>
      <span className="advice-extra">
        <ChanceBadge big label={labelFor(alt)} suffix={deadline ? `to arrive by ${hhmm(deadline)}` : undefined} />
        {pick ? (
          <span className="pz-reasons">
            {gaugeOf(alt) && gaugeOf(alt)!.level !== "good" && <span className="muted">{gaugeOf(alt)!.reason}</span>}
            {pick.reasons.map((r) => <span key={r} className="pz-reason"><Icon name="check-plain" size={16} />{r}</span>)}
            {pick.compromise && <span className="warn-line">{pick.compromise}</span>}
          </span>
        ) : (
          reasonFor(alt) && <span className="muted">{reasonFor(alt)}</span>
        )}
        {late && <span className="warn-line">No option gets you there by {hhmm(deadline)}. This is the earliest you can arrive.</span>}
      </span>
    </ConnectionCard>
  );
}
