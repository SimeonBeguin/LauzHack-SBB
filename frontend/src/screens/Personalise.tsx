// Personalise flow: a few quick questions. Defaults come from DEFAULT_PREFERENCES.
import type { Preferences } from "../types";

interface Props { value: Preferences; onChange: (p: Preferences) => void; onDone: () => void }

export default function Personalise({ value, onChange, onDone }: Props) {
  // TODO: one question per step, deadline picker, accessibility, max transfers
  return (
    <div className="card">
      <h3>Personalise</h3>
      <label>
        Arrive within {value.destination_radius_km} km of destination
        <input
          type="range" min={0} max={30} value={value.destination_radius_km}
          onChange={(e) => onChange({ ...value, destination_radius_km: Number(e.target.value) })}
        />
      </label>
      <label>
        <input
          type="checkbox" checked={value.avoid_replacement_bus}
          onChange={(e) => onChange({ ...value, avoid_replacement_bus: e.target.checked })}
        />
        Avoid replacement bus
      </label>
      <div><button onClick={onDone}>Show alternatives</button></div>
    </div>
  );
}
