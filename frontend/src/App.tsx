// Phone frame + screen router + overlays (sheet, toast, notification banner),
// with the presenter panel next to the phone.
import { useEffect, useState } from "react";
import { StoreProvider, useStore } from "./store";
import { hhmm } from "./lib/format";
import Home from "./screens/Home";
import DisruptionMode from "./screens/DisruptionMode";
import CategoryList from "./screens/CategoryList";
import PersonaliseSheet from "./screens/PersonaliseSheet";
import IncidentDetails from "./screens/IncidentDetails";
import CommuterSetup from "./screens/CommuterSetup";
import LockScreen, { NotificationCard } from "./screens/LockScreen";
import CommuterAlert from "./screens/CommuterAlert";
import ConnectionDetail from "./screens/ConnectionDetail";
import Personalize from "./screens/Personalize";
import BookingSetup from "./screens/BookingSetup";
import BookingAlertScreen from "./screens/BookingAlert";
import PlanTrip from "./screens/PlanTrip";
import DemoPanel from "./demo/DemoPanel";
import { Icon } from "./components/ui";

function Screen() {
  const { route } = useStore();
  switch (route.name) {
    case "home": return <Home />;
    case "disruption": return <DisruptionMode />;
    case "list": return <CategoryList category={route.category} />;
    case "details": return <IncidentDetails />;
    case "commuterSetup": return <CommuterSetup />;
    case "lock": return <LockScreen />;
    case "commuterAlert": return <CommuterAlert id={route.id} />;
    case "connection": return <ConnectionDetail id={route.id} />;
    case "personalize": return <Personalize />;
    case "bookingSetup": return <BookingSetup />;
    case "bookingAlert": return <BookingAlertScreen id={route.id} />;
    case "plan": return <PlanTrip />;
  }
}

function StatusBar({ dark }: { dark: boolean }) {
  const { clock } = useStore();
  return (
    <div className={`statusbar ${dark ? "on-dark" : ""}`}>
      <span>{hhmm(clock)}</span>
      <span className="statusbar-right" aria-hidden="true">
        <span className="signal"><i /><i /><i /><i /></span> 5G <span className="battery"><i /></span>
      </span>
    </div>
  );
}

// Bottom navigation like the SBB app: 6 icons, the active one in a raised black circle.
const TABS = [
  { id: "plan", label: "Plan", icon: "plan" },
  { id: "trips", label: "My trips", icon: "trips" },
  { id: "easyride", label: "EasyRide", icon: "toggle" },
  { id: "tickets", label: "Tickets", icon: "qr" },
  { id: "shop", label: "Shop & Services", icon: "shop" },
  { id: "profile", label: "Profile", icon: "user" },
];

function TabBar() {
  const { reset, showToast, route } = useStore();
  const activeId = ["disruption", "list", "details", "connection", "personalize", "plan"].includes(route.name) ? "plan" : "trips";
  return (
    <nav className="tabbar">
      {TABS.map((t) => {
        const active = t.id === activeId;
        return (
          <button key={t.id} className={active ? "active" : ""} aria-current={active ? "page" : undefined} aria-label={t.label}
            onClick={() => {
              if (t.id === "trips") reset({ name: "home" });
              else if (t.id === "plan") reset({ name: "disruption" });
              else showToast("Not part of this prototype");
            }}>
            <span className="tab-icon"><Icon name={t.icon} size={26} /></span>
            {active && <span className="tab-label">{t.label}</span>}
          </button>
        );
      })}
    </nav>
  );
}

function Phone() {
  const { route, toast, banner, dismissBanner, sheetOpen, clock, findNotification, openAlert } = useStore();
  const bannerNotification = banner ? findNotification(banner) : undefined;
  const isLock = route.name === "lock";

  return (
    <div className="phone">
      <div className={`phone-screen ${isLock ? "is-lock" : ""}`}>
        <StatusBar dark={isLock} />
        <div className="screen-scroll" key={JSON.stringify(route)} aria-hidden={sheetOpen || undefined}>
          <Screen />
        </div>
        {!isLock && <TabBar />}
        <PersonaliseSheet />
        {bannerNotification && (
          <div className="banner-layer">
            <NotificationCard notification={bannerNotification} now={clock}
              onOpen={() => { dismissBanner(); openAlert(banner!); }} />
          </div>
        )}
        {toast && <div className="toast" role="status">{toast}</div>}
      </div>
    </div>
  );
}

function Shell() {
  const [panel, setPanel] = useState(() => !new URLSearchParams(location.search).has("clean"));
  const { push, openAlert } = useStore();

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
    if (id) push({ name: "commuterAlert", id });
  }, [push]);

  // Clicking a real OS notification brings the app forward and opens the alert.
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const onMsg = (e: MessageEvent) => {
      if (e.data?.type !== "open-alert") return;
      if (e.data.id) openAlert(e.data.id);
    };
    navigator.serviceWorker.addEventListener("message", onMsg);
    return () => navigator.serviceWorker.removeEventListener("message", onMsg);
  }, [openAlert]);

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
