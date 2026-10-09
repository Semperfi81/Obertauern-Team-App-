// Team-App Service Worker – bei Änderungen am Frontend Versionsnummer erhöhen
const CACHE_NAME = "team-app-v6";
const PRECACHE = ["/", "/manifest.json", "/icon-192.png", "/icon-512.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((c) => c.addAll(PRECACHE)).catch(() => {}));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Netzwerk zuerst, bei Offline aus dem Cache. API nie cachen.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET" || req.url.includes("/api/")) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          const copy = res.clone();
          caches.open(CACHE_NAME).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((r) => r || (req.mode === "navigate" ? caches.match("/") : undefined)))
  );
});

// Push-Benachrichtigungen anzeigen
self.addEventListener("push", (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data && event.data.text() }; }
  event.waitUntil(
    self.registration.showNotification(d.title || "Crew Sport Gefäll", {
      body: d.body || "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: d.tag || undefined,
      renotify: !!d.tag,
      // Erinnerungen: bleiben sichtbar und vibrieren deutlich
      requireInteraction: !!d.alarm,
      vibrate: d.alarm ? [400, 150, 400, 150, 400] : [200],
      silent: false,
      data: { url: d.url || "/" },
    })
  );
});

// Tippen auf die Benachrichtigung öffnet die App (bzw. holt sie nach vorne)
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ("focus" in c) { c.postMessage({ type: "open", url }); return c.focus(); }
      }
      return self.clients.openWindow(url);
    })
  );
});
