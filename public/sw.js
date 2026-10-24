/**
 * Minimal service worker for Soletrade.
 *
 * Strategy:
 * - Precache build-specific static assets from /_next/static/*.
 * - Cache-first for static assets (/fonts/*, /icons/*, /_next/static/*).
 * - Network-first for navigations so users always get fresh HTML when online,
 *   falling back to the cached app shell and /offline page on failure.
 * - Never cache API routes, public token pages, or Stripe scripts.
 */

const STATIC_CACHE = "soletrade-static-v2";
const APP_SHELL = "/";
const OFFLINE_PAGE = "/offline";

const PRECACHE_ASSETS = [
  APP_SHELL,
  OFFLINE_PAGE,
  "/login",
  "/icons/soletrade-v1/icon-192x192.png",
  "/icons/soletrade-v1/icon-512x512.png",
  "/icons/soletrade-v1/icon-512x512-maskable.png",
  "/icons/soletrade-v1/apple-touch-icon.png",
];

const NEVER_CACHE = ["/api/", "/i/", "/q/", "/invite/", "/auth/", "/stripe/", "/db/"];

const STATIC_PATHS = ["/_next/static/", "/fonts/", "/icons/"];

function isNavigationRequest(request) {
  return request.mode === "navigate";
}

function shouldNeverCache(request) {
  const { pathname } = new URL(request.url);
  return NEVER_CACHE.some((prefix) => pathname.startsWith(prefix));
}

function isStaticAsset(request) {
  const { pathname } = new URL(request.url);
  return STATIC_PATHS.some((prefix) => pathname.startsWith(prefix));
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== STATIC_CACHE).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;

  // Bypass unsupported methods and non-GET requests.
  if (request.method !== "GET") return;

  // Never intercept API, public token, auth, or Stripe routes.
  if (shouldNeverCache(request)) return;

  // Navigation requests: network-first with offline fallback.
  if (isNavigationRequest(request)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (!response || response.status !== 200 || response.type !== "basic") {
            return response;
          }
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then((cached) => cached || caches.match(OFFLINE_PAGE))),
    );
    return;
  }

  // Static assets: cache-first with background refresh.
  if (isStaticAsset(request)) {
    event.respondWith(
      caches.match(request).then((cached) => {
        if (cached) {
          // Background revalidate.
          fetch(request)
            .then((response) => {
              if (response && response.status === 200) {
                caches.open(STATIC_CACHE).then((cache) => cache.put(request, response));
              }
            })
            .catch(() => {});
          return cached;
        }
        return fetch(request)
          .then((response) => {
            if (!response || response.status !== 200 || response.type !== "basic") {
              return response;
            }
            const clone = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
            return response;
          })
          .catch(() => new Response("", { status: 503, statusText: "Service Unavailable" }));
      }),
    );
    return;
  }

  // Default: network-first.
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.status === 200) {
          const clone = response.clone();
          caches.open(STATIC_CACHE).then((cache) => cache.put(request, clone));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});
