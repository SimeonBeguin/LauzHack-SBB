// Screen 3 of the mockup: a few quick questions, defaults pre-filled.
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Preferences } from "../types";
import { DELAY_DAY } from "../mocks/scenario";
import { atTime, hhmm } from "../lib/format";
import { BottomSheet, Chip } from "../components/ui";

export function preferencesSummary(p: Preferences): string {
  const parts = [`Radius ${p.destination_radius_km} km`];
  parts.push(p.deadline ? `by ${hhmm(p.deadline)}` : "no rush");
  if (p.avoid_replacement_bus) parts.push("no bus");
  return parts.join(" · ");
}

const DEADLINES = ["19:00", "19:30", "20:00"];

export default function PersonaliseSheet() {
  const { prefs, setPrefs, sheetOpen, setSheetOpen, showToast } = useStore();
  const [draft, setDraft] = useState<Preferences>(prefs);
  const [otherTime, setOtherTime] = useState("");

  useEffect(() => { if (sheetOpen) setDraft(prefs); }, [sheetOpen, prefs]);

  const set = (patch: Partial<Preferences>) => setDraft((d) => ({ ...d, ...patch }));
  const deadlineHm = draft.deadline ? hhmm(draft.deadline) : null;
  const isOther = deadlineHm != null && !DEADLINES.includes(deadlineHm);
  const noNeeds = !draft.accessible_only && !draft.luggage && !draft.stroller_bike;

  function apply() {
    setPrefs(draft);
    setSheetOpen(false);
    showToast("Options updated");
  }

  return (
    <BottomSheet open={sheetOpen} onClose={() => setSheetOpen(false)}>
      <h2 className="sheet-title">Adapt to your situation</h2>
      <p className="muted small">4 questions · your answers are kept for this trip</p>

      <section className="card q">
        <h3>How far from your destination can you arrive?</h3>
        <input type="range" min={0} max={25} step={1} value={draft.destination_radius_km}
          aria-label="Destination radius in km"
          style={{ ["--fill" as string]: `${(draft.destination_radius_km / 25) * 100}%` }}
          onChange={(e) => set({ destination_radius_km: Number(e.target.value) })} />
        <div className="range-labels"><span>0 km</span><strong>{draft.destination_radius_km} km</strong><span>25 km</span></div>
      </section>

      <section className="card q">
        <h3>You need to arrive by…</h3>
        <div className="chips">
          <Chip active={!draft.deadline} onClick={() => set({ deadline: null })}>No rush</Chip>
          {DEADLINES.map((d) => (
            <Chip key={d} active={deadlineHm === d} onClick={() => set({ deadline: atTime(DELAY_DAY, d) })}>{d}</Chip>
          ))}
          <label className={`chip chip-btn ${isOther ? "chip-active" : ""}`}>
            Other
            <input type="time" value={isOther ? deadlineHm! : otherTime} aria-label="Other time"
              onChange={(e) => { setOtherTime(e.target.value); if (e.target.value) set({ deadline: atTime(DELAY_DAY, e.target.value) }); }} />
          </label>
        </div>
      </section>

      <section className="card q">
        <h3>Accessibility</h3>
        <div className="chips">
          <Chip active={draft.accessible_only} onClick={() => set({ accessible_only: !draft.accessible_only })}>Reduced mobility</Chip>
          <Chip active={!!draft.luggage} onClick={() => set({ luggage: !draft.luggage })}>Luggage</Chip>
          <Chip active={!!draft.stroller_bike} onClick={() => set({ stroller_bike: !draft.stroller_bike })}>Stroller / bike</Chip>
          <Chip active={noNeeds} onClick={() => set({ accessible_only: false, luggage: false, stroller_bike: false })}>None</Chip>
        </div>
      </section>

      <section className="card q">
        <h3>Comfort</h3>
        <div className="chips">
          <Chip active={draft.avoid_replacement_bus} onClick={() => set({ avoid_replacement_bus: !draft.avoid_replacement_bus })}>Avoid replacement bus</Chip>
          <Chip active={!!draft.few_transfers} onClick={() => set({ few_transfers: !draft.few_transfers })}>Few transfers</Chip>
          <Chip active={!!draft.seat} onClick={() => set({ seat: !draft.seat })}>Seat</Chip>
        </div>
      </section>

      <button className="btn btn-primary btn-lg" onClick={apply}>Update options</button>
    </BottomSheet>
  );
}
