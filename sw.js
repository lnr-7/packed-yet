// Offline support: cache the app shell on install, serve from cache first,
// and refresh the cache in the background when online.
const CACHE = "packed-yet-v1";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./logic.js",
  "./manifest.webmanifest",
  "./icons/icon.svg",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./fonts/barlow-400.woff2",
  "./fonts/barlow-600.woff2",
  "./fonts/barlow-condensed-600.woff2",
  "./fonts/barlow-condensed-700.woff2",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE).then(async (cache) => {
      const cached = await cache.match(request, { ignoreSearch: true });
      const network = fetch(request)
        .then((response) => {
          if (response && response.ok) cache.put(request, response.clone());
          return response;
        })
        .catch(() => null);
      if (cached) {
        network.catch(() => {});
        return cached;
      }
      const fresh = await network;
      if (fresh) return fresh;
      // Deep links to a trip load the shell when offline.
      return (await cache.match("./index.html")) || Response.error();
    }),
  );
});
