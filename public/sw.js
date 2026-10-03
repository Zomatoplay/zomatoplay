/*
 * Zomato Play service worker.
 *
 * WHAT IT CACHES, AND WHAT IT NEVER TOUCHES
 * -----------------------------------------
 * This is a finance app. A cached page is a cached balance, so the rule is:
 *
 *   /_next/static/*, /pwa-icon/*   cache-first. Content-hashed build assets and
 *                                  icons: immutable, identical for everyone,
 *                                  carry no account data.
 *   page navigations               NETWORK ONLY. On a network *failure* (not an
 *                                  error status) the static /offline.html is
 *                                  shown — a page with no data in it. A page is
 *                                  never served from cache, so a stale balance
 *                                  can never be shown as current.
 *   everything else                not intercepted at all: server actions
 *                                  (POST), React Server Component payloads,
 *                                  /api/*, the CRM, auth, Firebase, TronGrid,
 *                                  S3. The browser handles them exactly as it
 *                                  would with no service worker.
 *
 * Because it never sees or stores a response for an authenticated request, it
 * cannot interfere with the session cookie, sign-in, or sign-out.
 *
 * Bump CACHE_VERSION to discard old caches on the next activation.
 */

// v2: discards the placeholder "N" icons cached under v1.
const CACHE_VERSION = "v2";
const STATIC_CACHE = `zomatoplay-static-${CACHE_VERSION}`;
// Caches written before the rename carry the old prefix; sweep both.
const CACHE_PREFIXES = ["zomatoplay-", "nanotron-"];
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.add(new Request(OFFLINE_URL, { cache: "reload" })))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) && key !== STATIC_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

function isImmutableAsset(url) {
  return url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/pwa-icon/");
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(async () => {
        const cached = await caches.match(OFFLINE_URL);
        return cached ?? Response.error();
      }),
    );
    return;
  }

  if (isImmutableAsset(url)) {
    event.respondWith(
      caches.open(STATIC_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        // Only complete, same-origin, successful responses are kept.
        if (response.ok && response.type === "basic") {
          cache.put(request, response.clone());
        }
        return response;
      }),
    );
  }
  // Anything else: not intercepted.
});
