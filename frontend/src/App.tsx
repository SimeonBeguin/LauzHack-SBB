// Simple screen state machine. TODO: swap for a router if the app grows.
import { useState } from "react";
import { DEFAULT_PREFERENCES, type AlternativeCategory, type Preferences } from "./types";
import JourneyStatus from "./screens/JourneyStatus";
import Personalise from "./screens/Personalise";
import Alternatives from "./screens/Alternatives";
import AlternativeList from "./screens/AlternativeList";
import CommuterSetup from "./screens/CommuterSetup";

export type Screen = "status" | "personalise" | "alternatives" | "list" | "commuter";

const JOURNEY_ID = "demo-1";

export default function App() {
  const [screen, setScreen] = useState<Screen>("status");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [category, setCategory] = useState<AlternativeCategory>("fastest");

  return (
    <div className="app">
      <div className="header">SBB Disruption Helper</div>
      {screen === "status" && <JourneyStatus journeyId={JOURNEY_ID} onNeedHelp={() => setScreen("personalise")} />}
      {screen === "personalise" && (
        <Personalise value={prefs} onChange={setPrefs} onDone={() => setScreen("alternatives")} />
      )}
      {screen === "alternatives" && (
        <Alternatives
          journeyId={JOURNEY_ID}
          preferences={prefs}
          onOpenCategory={(c) => { setCategory(c); setScreen("list"); }}
        />
      )}
      {screen === "list" && (
        <AlternativeList journeyId={JOURNEY_ID} preferences={prefs} category={category} onBack={() => setScreen("alternatives")} />
      )}
      {screen === "commuter" && <CommuterSetup onDone={() => setScreen("status")} />}
      <nav>
        <button onClick={() => setScreen("status")}>Status</button>{" "}
        <button onClick={() => setScreen("commuter")}>My regular trip</button>
      </nav>
    </div>
  );
}
