// Phone frame + screen router + overlays (sheet, toast, notification banner),
// with the presenter panel next to the phone.
import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { hhmm } from "./lib/format";
import { COMMUTER_ALERTS } from "./mocks/scenario";
import Home from "./screens/Home";
import DisruptionMode from "./screens/DisruptionMode";
import CategoryList from "./screens/CategoryList";
import PersonaliseSheet from "./screens/PersonaliseSheet";
import IncidentDetails from "./screens/IncidentDetails";
import CommuterSetup from "./screens/CommuterSetup";
import LockScreen, { NotificationCard } from "./screens/LockScreen";
import CommuterAlert from "./screens/CommuterAlert";
import DemoPanel from "./demo/DemoPanel";

function Screen() {
  const { route } = useStore();
  switch (route.name) {
    case "home": return <Home />;
    case "disruption": return <DisruptionMode />;
    case "list": return <CategoryList category={route.category} />;
    case "details": return <IncidentDetails />;
    case "commuterSetup": return <CommuterSetup />;
    case "lock": return <LockScreen />;
    case "commuterAlert": return <CommuterAlert index={route.index} />;
  }
}

function StatusBar() {
  const { clock } = useStore();
  return (
    <div className="statusbar">
      <span>{hhmm(clock)}</span>
      <span className="statusbar-right" aria-hidden="true">
        <span className="signal"><i /><i /><i /><i /></span> 5G <span className="battery"><i /></span>
      </span>
    </div>
  );
}

function Phone() {
  const { route, toast, banner, dismissBanner, push, sheetOpen } = useStore();
  const isLock = route.name === "lock";

  return (
    <div className="phone">
      <div className={`phone-screen ${isLock ? "is-lock" : ""}`}>
        <StatusBar />
        <div className="screen-scroll" key={JSON.stringify(route)} aria-hidden={sheetOpen || undefined}>
          <Screen />
        </div>
        <PersonaliseSheet />
        {banner != null && (
          <div className="banner-layer">
            <NotificationCard index={banner} now={COMMUTER_ALERTS[banner].clock}
              onOpen={() => { dismissBanner(); push({ name: "commuterAlert", index: banner }); }} />
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </div>
  );
}

function Shell() {
  const [panel, setPanel] = useState(() => !new URLSearchParams(location.search).has("clean"));
  const { push } = useStore();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "d" || e.key === "D") setPanel((p) => !p);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Opened from an OS notification while the app was closed: /?alert=n1
  useEffect(() => {
    const id = new URLSearchParams(location.search).get("alert");
    const i = COMMUTER_ALERTS.findIndex((a) => a.notification.id === id);
    if (i >= 0) push({ name: "commuterAlert", index: i });
  }, [push]);

  // Clicking a real OS notification brings the app forward and opens the alert.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open-alert") return;
      const i = COMMUTER_ALERTS.findIndex((a) => a.notification.id === e.data.id);
      if (i >= 0) push({ name: "commuterAlert", index: i });
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [push]);

  return (
    <div className={`stage ${panel ? "with-panel" : ""}`}>
      <Phone />
      {panel ? <DemoPanel onClose={() => setPanel(false)} />
        : <button className="demo-fab" onClick={() => setPanel(true)} aria-label="Show presenter controls">Demo</button>}
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}
