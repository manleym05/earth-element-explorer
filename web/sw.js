// Minimal service worker: it only supplies an offline page. Nothing else is cached, so the app and its
// data always come fresh from the network (no stale-version bugs after a deploy).
const OFFLINE = "offline.html";
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open("offline-v1").then((c) => c.addAll([OFFLINE, "icons/icon-192.png"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== "offline-v1").map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  if (e.request.mode !== "navigate") return;  // everything except page loads goes straight to the network
  e.respondWith(fetch(e.request).catch(() => caches.match(OFFLINE)));
});
