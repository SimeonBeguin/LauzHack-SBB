// Secondary preferences. The main question (arrival time) is on the Need help
// screen itself; these only refine the options and keep sensible defaults.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Preferences } from "../types";
import { BottomSheet, Chip } from "../components/ui";
import { syncAnswers } from "../lib/personalize";

export function preferencesSummary(p: Preferences): string {
  const parts: string[] = [];
  if (p.avoid_replacement_bus) parts.push("no replacement bus");
  if (p.accessible_only) parts.push("step-free");
  parts.push(`up to ${p.destination_radius_km} km away`);
  return parts.join(", ");
}

export default function PersonaliseSheet() {
  const { prefs, setPrefs, sheetOpen, setSheetOpen, showToast } = useStore();
  const [draft, setDraft] = useState<Preferences>(prefs);

  useEffect(() => { if (sheetOpen) setDraft(prefs); }, [sheetOpen, prefs]);

  const set = (patch: Partial<Preferences>) => setDraft((d) => ({ ...d, ...patch }));
  const noNeeds = !draft.accessible_only && !draft.luggage && !draft.stroller_bike;

  function apply() {
    setPrefs(syncAnswers(draft));
    setSheetOpen(false);
    showToast("Options updated");
  }

  return (
    <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)} title="Preferences">
      <section className="q">
        <h3>Can you get off near your destination instead?</h3>
        <p className="muted small">For example at another station in the same city.</p>
        <input type="range" min={0} max={25} step={1} value={draft.destination_radius_km}
          aria-label="Distance from destination in km"
          style={{ ["--fill" as string]: `${(draft.destination_radius_km / 25) * 100}%` }}
          onChange={(e) => set({ destination_radius_km: Number(e.target.value) })} />
        <div className="range-labels"><span>Only my station</span><strong>{draft.destination_radius_km} km</strong><span>25 km</span></div>
      </section>

      <section className="q">
        <h3>Do you need help getting around?</h3>
        <div className="chips">
          <Chip active={noNeeds} onClick={() => set({ accessible_only: false, luggage: false, stroller_bike: false })}>No</Chip>
          <Chip active={draft.accessible_only} onClick={() => set({ accessible_only: !draft.accessible_only })}>Wheelchair / reduced mobility</Chip>
          <Chip active={!!draft.luggage} onClick={() => set({ luggage: !draft.luggage })}>Heavy luggage</Chip>
          <Chip active={!!draft.stroller_bike} onClick={() => set({ stroller_bike: !draft.stroller_bike })}>Stroller / bike</Chip>
        </div>
      </section>

      <section className="q">
        <h3>Comfort</h3>
        <div className="chips">
          <Chip active={draft.avoid_replacement_bus} onClick={() => set({ avoid_replacement_bus: !draft.avoid_replacement_bus })}>Avoid replacement buses</Chip>
          <Chip active={!!draft.few_transfers} onClick={() => set({ few_transfers: !draft.few_transfers })}>Few changes</Chip>
        </div>
      </section>

      <button className="btn btn-primary btn-lg" onClick={apply}>Show my options</button>
    </BottomSheet>
  );
}
