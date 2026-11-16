// Open TV no longer ships a service worker. This worker exists only to
// retire the pre-rebuild PWA worker (which cached the old app shell
// cache-first under opentv-vN): on activation it clears every cache on the
// origin and unregisters itself. Browsers that never installed the old PWA
// never run this; the page itself never registers a worker (CSP worker-src
// 'none'). Deployed 2026-11-16 (audit R5).
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.map((key) => caches.delete(key))))
      .then(() => self.registration.unregister()),
  );
});
