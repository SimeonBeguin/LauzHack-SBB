// App state in one small context. Everything shown comes from the backend:
// the live situation (moved by the presenter controls), the journey status,
// the alternatives and the commuter alerts. The app clock is the situation's.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  changeSituation, getAlerts, getAlternatives, getJourneyDetails, getJourneyStatus, getSituation, listCommuterTrips,
} from "./api/client";
import { applyPreferences } from "./lib/ranking";
import {
  DEFAULT_PREFERENCES, type AlternativeCategory, type AlternativesResponse, type CommuterAlert, type CommuterTrip,
  type DisruptionStatus, type IncidentDetails, type Preferences, type Situation, type SituationAction,
} from "./types";
import { showOsNotification } from "./lib/osNotifications";

export type Route =
  | { name: "home" }
  | { name: "disruption" }
  | { name: "list"; category: AlternativeCategory }
  | { name: "details" }
  | { name: "commuterSetup" }
  | { name: "lock" }
  | { name: "commuterAlert"; id: string }
  | { name: "connection"; id: string };

const ALERT_POLL_MS = 5000;

interface Store {
  route: Route;
  push: (r: Route) => void;
  back: () => void;
  reset: (r: Route) => void;

  clock: string; // the situation's "now" (real time only until it is loaded)
  situation: Situation | null;
  act: (a: SituationAction) => Promise<void>;
  error: string | null;

  prefs: Preferences;
  setPrefs: (p: Preferences) => void;
  sheetOpen: boolean;
  setSheetOpen: (o: boolean) => void;

  status: DisruptionStatus | null;
  details: IncidentDetails | null;
  alternatives: AlternativesResponse | null;
  loading: boolean;

  trips: CommuterTrip[];
  saveTrip: (t: CommuterTrip) => void;
  alerts: CommuterAlert[];
  refreshAlerts: () => void;
  banner: string | null;
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

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function StoreProvider({ children }: { children: ReactNode }) {
  const [stack, setStack] = useState<Route[]>([{ name: "home" }]);
  const [situation, setSituation] = useState<Situation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<Preferences>(DEFAULT_PREFERENCES);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [status, setStatus] = useState<DisruptionStatus | null>(null);
  const [details, setDetails] = useState<IncidentDetails | null>(null);
  const [alternatives, setAlternatives] = useState<AlternativesResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [trips, setTrips] = useState<CommuterTrip[]>([]);
  const [alerts, setAlerts] = useState<CommuterAlert[]>([]);
  const [banner, setBanner] = useState<string | null>(null);
  const [osEnabled, setOsEnabled] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastTimer = useRef<number>();
  const bannerTimer = useRef<number>();
  const seenAlerts = useRef<Set<string> | null>(null);

  const route = stack[stack.length - 1];
  const routeRef = useRef(route);
  routeRef.current = route;
  const osRef = useRef(osEnabled);
  osRef.current = osEnabled;
  const push = useCallback((r: Route) => setStack((s) => [...s, r]), []);
  const back = useCallback(() => setStack((s) => (s.length > 1 ? s.slice(0, -1) : s)), []);
  const reset = useCallback((r: Route) => setStack(r.name === "home" ? [r] : [{ name: "home" }, r]), []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  }, []);

  // Commuter alerts: new ones drop in as a banner (or on the lock screen) and as OS notifications.
  const refreshAlerts = useCallback(() => {
    getAlerts().then((list) => {
      setAlerts(list);
      const seen = seenAlerts.current;
      seenAlerts.current = new Set(list.map((a) => a.notification.id ?? ""));
      if (!seen) return; // first load: nothing is "new"
      const fresh = list.filter((a) => !seen.has(a.notification.id ?? ""));
      const last = fresh[fresh.length - 1];
      if (!last) return;
      for (const a of fresh) if (osRef.current) showOsNotification(a.notification);
      if (routeRef.current.name !== "lock") {
        setBanner(last.notification.id ?? null);
        window.clearTimeout(bannerTimer.current);
        bannerTimer.current = window.setTimeout(() => setBanner(null), 7000);
      }
    }).catch(() => { /* shown through `error` by the other calls */ });
  }, []);

  // Load the situation; retry while the backend is starting (first load can take a while).
  useEffect(() => {
    let alive = true;
    let timer: number | undefined;
    const load = () => getSituation()
      .then((s) => { if (alive) { setSituation(s); setError(null); } })
      .catch((e) => { if (alive) { setError(message(e)); timer = window.setTimeout(load, 3000); } });
    load();
    return () => { alive = false; window.clearTimeout(timer); };
  }, []);

  useEffect(() => {
    listCommuterTrips().then(setTrips).catch(() => {});
    refreshAlerts();
    const id = window.setInterval(refreshAlerts, ALERT_POLL_MS);
    return () => window.clearInterval(id);
  }, [refreshAlerts]);

  // Everything is recomputed when the situation or the preferences change.
  const sitKey = situation ? JSON.stringify(situation) : null;
  useEffect(() => {
    if (!sitKey) return;
    let alive = true;
    setLoading(true);
    getJourneyDetails().then((d) => alive && setDetails(d)).catch(() => alive && setDetails(null));
    Promise.all([getJourneyStatus(), getAlternatives(prefs)])
      .then(([s, a]) => {
        if (!alive) return;
        setStatus(s);
        const now = s.estimate.as_of ?? s.last_update;
        setAlternatives(applyPreferences(a, prefs, s.estimate.probabilities ?? [], now));
        setError(null);
      })
      .catch((e) => alive && setError(message(e)))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [sitKey, prefs]);

  const act = useCallback(async (a: SituationAction) => {
    try {
      const prev = situation;
      const next = await changeSituation(a);
      setSituation(next);
      if (a.action === "reset") { seenAlerts.current = null; setBanner(null); }
      const fresh = next.updates.length > (prev?.updates.length ?? 0) ? next.updates[next.updates.length - 1] : null;
      if (fresh && a.action !== "reset") showToast(`SBB update: ${fresh.text}`);
      refreshAlerts();
    } catch (e) {
      showToast(message(e));
    }
  }, [situation, showToast, refreshAlerts]);

  const saveTrip = useCallback((t: CommuterTrip) => {
    setTrips((ts) => [t, ...ts.filter((x) => x.id !== t.id)]);
    refreshAlerts();
  }, [refreshAlerts]);

  const clock = situation?.clock ?? new Date().toISOString();

  const value = useMemo<Store>(() => ({
    route, push, back, reset, clock, situation, act, error,
    prefs, setPrefs, sheetOpen, setSheetOpen,
    status, details, alternatives, loading,
    trips, saveTrip, alerts, refreshAlerts, banner, dismissBanner: () => setBanner(null),
    osEnabled, setOsEnabled, toast, showToast,
  }), [route, push, back, reset, clock, situation, act, error, prefs, sheetOpen, status, details, alternatives,
    loading, trips, saveTrip, alerts, refreshAlerts, banner, osEnabled, toast, showToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
