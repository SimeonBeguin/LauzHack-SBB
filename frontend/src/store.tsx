// App state in one small context. Everything shown comes from the backend:
// the live situation (moved by the presenter controls), the journey status,
// the alternatives and the commuter alerts. The app clock is the situation's.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  changeSituation, deleteBooking, getAlerts, getAlternatives, getBookingAlerts, getJourneyDetails, getJourneyStatus,
  getSituation, listBookings, listCommuterTrips,
} from "./api/client";
import { applyPreferences } from "./lib/ranking";
import {
  DEFAULT_PREFERENCES, type Alternative, type AlternativeCategory, type AlternativesResponse, type BookedTrip,
  type BookingAlert, type CommuterAlert, type CommuterTrip, type DisruptionStatus, type IncidentDetails,
  type Notification, type Preferences, type Situation, type SituationAction,
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
  | { name: "connection"; id: string }
  | { name: "personalize" }
  | { name: "bookingSetup" }
  | { name: "bookingAlert"; id: string }
  | { name: "plan" };

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

  // Prevention: booked trips (idea 2), demo traffic jam (idea 4), "Plan a trip" results (idea 3)
  bookings: BookedTrip[];
  saveBooking: (b: BookedTrip) => void;
  removeBooking: (id: string) => void;
  bookingAlerts: BookingAlert[];
  jam: number | null;               // presenter: simulated jam (min) on every bus leg
  setJam: (m: number | null) => void;
  planned: Alternative[];
  setPlanned: (p: Alternative[]) => void;
  /** Open a notification (commuter or booked trip) by its id. */
  openAlert: (id: string) => void;
  /** The notification with this id, from either list. */
  findNotification: (id: string) => Notification | undefined;

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
  const [bookings, setBookings] = useState<BookedTrip[]>([]);
  const [bookingAlerts, setBookingAlerts] = useState<BookingAlert[]>([]);
  const [jam, setJamState] = useState<number | null>(null);
  const [planned, setPlanned] = useState<Alternative[]>([]);
  const jamRef = useRef<number | null>(null);
  jamRef.current = jam;
  const bookingAlertsRef = useRef<BookingAlert[]>([]);
  bookingAlertsRef.current = bookingAlerts;
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

  // Commuter and booked-trip alerts: new ones drop in as a banner (or on the
  // lock screen) and as OS notifications.
  const refreshAlerts = useCallback(() => {
    Promise.all([
      getAlerts(),
      getBookingAlerts(undefined, jamRef.current).catch(() => bookingAlertsRef.current),
    ]).then(([list, booked]) => {
      setAlerts(list);
      setBookingAlerts(booked);
      const all = [...list, ...booked].map((a) => a.notification)
        .sort((x, y) => new Date(x.created_at).getTime() - new Date(y.created_at).getTime());
      const seen = seenAlerts.current;
      seenAlerts.current = new Set(all.map((n) => n.id ?? ""));
      if (!seen) return; // first load: nothing is "new"
      const fresh = all.filter((n) => !seen.has(n.id ?? ""));
      const last = fresh[fresh.length - 1];
      if (!last) return;
      for (const n of fresh) if (osRef.current) showOsNotification(n);
      if (routeRef.current.name !== "lock") {
        setBanner(last.id ?? null);
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
    listBookings().then(setBookings).catch(() => {});
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
      if (a.action === "reset") { seenAlerts.current = null; setBanner(null); setJamState(null); jamRef.current = null; }
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

  const saveBooking = useCallback((b: BookedTrip) => {
    setBookings((bs) => [...bs.filter((x) => x.id !== b.id), b]);
    refreshAlerts();
  }, [refreshAlerts]);

  const removeBooking = useCallback((id: string) => {
    setBookings((bs) => bs.filter((x) => x.id !== id));
    deleteBooking(id).catch(() => {});
  }, []);

  // The demo jam changes what the booked-trip check sees: check again right away.
  const setJam = useCallback((m: number | null) => {
    setJamState(m);
    jamRef.current = m;
    refreshAlerts();
  }, [refreshAlerts]);

  const findNotification = useCallback((id: string) =>
    [...alerts, ...bookingAlerts].map((a) => a.notification).find((n) => n.id === id), [alerts, bookingAlerts]);

  const openAlert = useCallback((id: string) => {
    const booked = bookingAlertsRef.current.some((a) => a.notification.id === id);
    setStack((st) => [...st, booked ? { name: "bookingAlert", id } : { name: "commuterAlert", id }]);
  }, []);

  const clock = situation?.clock ?? new Date().toISOString();

  const value = useMemo<Store>(() => ({
    route, push, back, reset, clock, situation, act, error,
    prefs, setPrefs, sheetOpen, setSheetOpen,
    status, details, alternatives, loading,
    trips, saveTrip, alerts, refreshAlerts, banner, dismissBanner: () => setBanner(null),
    bookings, saveBooking, removeBooking, bookingAlerts, jam, setJam, planned, setPlanned, openAlert, findNotification,
    osEnabled, setOsEnabled, toast, showToast,
  }), [route, push, back, reset, clock, situation, act, error, prefs, sheetOpen, status, details, alternatives,
    loading, trips, saveTrip, alerts, refreshAlerts, banner, bookings, saveBooking, removeBooking, bookingAlerts, jam,
    setJam, planned, openAlert, findNotification, osEnabled, toast, showToast]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
