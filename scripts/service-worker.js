// Open TV's service worker. The build replaces __CACHE__ with a name made from the
// version, commit and build time, so every deploy gets a fresh cache and the old one is
// removed: returning visitors never keep an old app shell.
const CACHE = "__CACHE__";
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add("./"))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  // Only this site's own files. Streams, guides and APIs go to the network untouched.
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigation") {
    // The page itself: the network first, the cached shell when offline.
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          if (response.ok)
            void caches.open(CACHE).then((cache) => cache.put("./", copy));
          return response;
        })
        .catch(() => caches.match("./").then((hit) => hit || Response.error())),
    );
    return;
  }
  if (url.pathname.includes("/assets/")) {
    // Hashed build files never change: the cache first.
    event.respondWith(
      caches.match(request).then(
        (hit) =>
          hit ||
          fetch(request).then((response) => {
            const copy = response.clone();
            if (response.ok)
              void caches.open(CACHE).then((cache) => cache.put(request, copy));
            return response;
          }),
      ),
    );
  }
});
