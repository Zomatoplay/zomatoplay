"use client";

import { useEffect } from "react";

/**
 * Registers `/sw.js` — production only.
 *
 * In development a service worker caching `/_next/static` would serve stale
 * hot-reload chunks and make every change look like it did not apply. The
 * worker itself caches only hashed static assets and never a page or an API
 * response (see `public/sw.js`), so registering it cannot make a financial
 * figure stale.
 *
 * `updateViaCache: "none"` makes the browser re-check the worker script on
 * every navigation, so a deploy that changes it takes effect promptly.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .register("/sw.js", { scope: "/", updateViaCache: "none" })
      .catch(() => {
        // An unregistered worker only means no offline page and no asset
        // cache; the app works identically without one.
      });
  }, []);
  return null;
}
