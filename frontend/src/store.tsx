// App + demo state in one small context: navigation stack, preferences,
// replay step of the incident, delivered commuter alerts, toasts and banners.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAlternatives, getJourneyDetails, getJourneyStatus } from "./api/client";
import { COMMUTER_ALERTS, COMMUTER_START_CLOCK, COMMUTER_TRIP, DELAY_JOURNEY, DELAY_STEPS } from "./mocks/scenario";
import { DEFAULT_PREFERENCES, type AlternativeCategory, type AlternativesResponse, type CommuterTrip, type DisruptionStatus, type IncidentDetails, type Preferences } from "./types";
import { showOsNotification } from "./lib/osNotifications";

export type Route =
  | { name: "home" }
  | { name: "disruption" }
  | { name: "list"; category: AlternativeCategory }
  | { name: "details" }
  | { name: "commuterSetup" }
  | { name: "lock" }
  | { name: "commuterAlert"; index: number }
  | { name: "connection"; id: string };

export type Scenario = "delay" | "commuter";

interface Store {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  reset: (r: Route) => void;

  scenario: Scenario;
  clock: string;

  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
  sheetOpen: boolean;
  setSheetOpen: (o: boolean) => void;

  delayStep: number;
  setDelayStep: (i: number) => void;
  status: DisruptionStatus | null;
  details: IncidentDetails | null;
  alternatives: AlternativesResponse | null;
  loading: boolean;

  trips: CommuterTrip[];
  saveTrip: (t: CommuterTrip) => void;
  delivered: number;
  deliverAlert: (i: number) => void;
  resetCommuter: () => void;
  banner: number | null;
  dismissBanner: () => void;

  osEnabled: boolean;
  setOsEnabled: (b: boolean) => void;

  toast: string | null;
  showToast: (msg: string) => void;
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error("useStore outside StoreProvider");
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);
  const [scenario, setScenario] = useState<Scenario>("delay");
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [delayStep, setDelayStepRaw] = useState(0);
  const [status, setStatus] = useState<DisruptionStatus | null>(null);
  const [details, setDetails] = useState<IncidentDetails | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<CommuterTrip[]>([COMMUTER_TRIP]);
  const [delivered, setDelivered] = useState(0);
  const [banner, setBanner] = useState<number | null>(null);
  const [osEnabled, setOsEnabled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const bannerTimer = useRef<number>();

  const route = stack[stack.length - 1];
  const routeRef = useRef(route);
  routeRef.current = route;
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((r: Route) => setStack(r.name === "home" ? [r] : [{ name: "home" }, r]), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  useEffect(() => {
    let alive = true;
    getJourneyDetails(DELAY_JOURNEY.id, delayStep).then((d) => alive && setDetails(d)).catch(() => alive && setDetails(null));
    return () => { alive = false; };
  }, [delayStep]);

  // Fetch status + alternatives once per (step, prefs); screens share the result.
  useEffect(() => {
    let alive = true;
    setLoading(true);
    Promise.all([
      getJourneyStatus(DELAY_JOURNEY.id, delayStep),
      getAlternatives(DELAY_JOURNEY.id, prefs, delayStep),
    ]).then(([s, a]) => {
      if (!alive) return;
      setStatus(s);
      setAlternatives(a);
      setLoading(false);
    });
    return () => { alive = false; };
  }, [delayStep, prefs]);

  const setDelayStep = useCallback((i: number) => {
    setScenario("delay");
    setDelayStepRaw(i);
    const msg = DELAY_STEPS[i]?.toast;
    if (msg) showToast(msg);
  }, [showToast]);

  const deliverAlert = useCallback((i: number) => {
    setScenario("commuter");
    setDelivered((d) => Math.max(d, i + 1));
    const n = COMMUTER_ALERTS[i].notification;
    if (osEnabled) showOsNotification(n);
    // On the lock screen the notification lands in the stack; inside the app it drops in as a banner.
    if (routeRef.current.name !== "lock") {
      setBanner(i);
      window.clearTimeout(bannerTimer.current);
      bannerTimer.current = window.setTimeout(() => setBanner(null), 7000);
    }
  }, [osEnabled]);

  const resetCommuter = useCallback(() => { setDelivered(0); setBanner(null); }, []);

  const saveTrip = useCallback((t: CommuterTrip) => {
    setTrips((ts) => [t, ...ts.filter((x) => x.id !== t.id)]);
  }, []);

  // Scenario follows the screen being shown.
  useEffect(() => {
    if (route.name === "lock" || route.name === "commuterAlert" || route.name === "commuterSetup") setScenario("commuter");
    if (route.name === "disruption" || route.name === "list" || route.name === "details") setScenario("delay");
  }, [route.name]);

  const clock = scenario === "commuter"
    ? (delivered > 0 ? COMMUTER_ALERTS[delivered - 1].clock : COMMUTER_START_CLOCK)
    : DELAY_STEPS[delayStep].clock;

  const value = useMemo<Store>(() => ({
    route, push, back, reset, scenario, clock,
    prefs, setPrefs, sheetOpen, setSheetOpen,
    delayStep, setDelayStep, status, details, alternatives, loading,
    trips, saveTrip, delivered, deliverAlert, resetCommuter,
    banner, dismissBanner: () => setBanner(null),
    osEnabled, setOsEnabled, toast, showToast,
  }), [route, push, back, reset, scenario, clock, prefs, sheetOpen, delayStep, setDelayStep, status, details, alternatives,
    loading, trips, saveTrip, delivered, deliverAlert, resetCommuter, banner, osEnabled, toast, showToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
