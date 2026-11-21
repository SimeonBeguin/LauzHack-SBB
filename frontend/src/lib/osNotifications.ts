// Real OS notifications through a service worker (tier 2 of the notification demo).
// Works on localhost in Chrome/Edge/Firefox (shows a real macOS/Windows notification).
// On iPhone it only works for a web app added to the home screen, so the
// simulated lock screen stays the main demo.
import type { Notification as AppNotification } from "../types";

export function osNotificationsSupported(): boolean {
  return "Notification" in window && "serviceWorker" in navigator;
}

export async function enableOsNotifications(): Promise<boolean> {
  if (!osNotificationsSupported()) return false;
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return false;
  await navigator.serviceWorker.register("/sw.js");
  return true;
}

export async function showOsNotification(n: AppNotification): Promise<void> {
  if (!osNotificationsSupported() || Notification.permission !== "granted") return;
  const reg = await navigator.serviceWorker.ready;
  await reg.showNotification(n.title, {
    body: n.body,
    tag: n.id ?? n.title,
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: { id: n.id },
  });
}
