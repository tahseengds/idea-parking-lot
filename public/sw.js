// Service worker: network-first so new deploys always win; cache is an offline
// fallback only. Bump CACHE to purge older caches.
const CACHE = "ideas-shell-v3";
const SHELL = [
  "/",
  "/index.html",
  "/styles.css",
  "/app.js",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);

  // Never cache the API — always hit the network, surface a clean error offline.
  if (url.pathname.startsWith("/api/")) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(JSON.stringify({ error: "You're offline." }), {
            status: 503,
            headers: { "Content-Type": "application/json" },
          })
      )
    );
    return;
  }

  // Same-origin shell: network-first, fall back to cache when offline.
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;
          if (request.mode === "navigate") return caches.match("/index.html");
          return Response.error();
        })
    );
    return;
  }

  // Cross-origin (e.g. fonts): just go to network.
  event.respondWith(fetch(request).catch(() => caches.match(request)));
});
