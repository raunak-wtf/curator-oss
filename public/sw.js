// Cleans up any stale Service Worker previously registered on this origin (such as localhost:3000).
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.registration.unregister());
});
