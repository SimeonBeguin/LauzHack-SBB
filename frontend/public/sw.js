// Service worker for the commuter alert demo: shows OS notifications and
// brings the app to the front when one is clicked.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const id = e.notification.data && e.notification.data.id;
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      const client = clients[0];
      if (client) {
        client.postMessage({ type: "open-alert", id });
        return client.focus();
      }
      return self.clients.openWindow(`/?alert=${id || ""}`);
    }),
  );
});
