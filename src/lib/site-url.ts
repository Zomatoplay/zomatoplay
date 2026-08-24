/**
 * The canonical origin for links that leave the application.
 *
 * Every email Supabase sends carries a URL back into this app — confirmation,
 * magic link, password recovery. Getting that origin wrong is not cosmetic: it
 * sends a production user to `localhost`, where the link cannot work and,
 * because the one-time code is consumed by the attempt, cannot be retried.
 *
 * ORDER OF PREFERENCE, AND WHY
 * ----------------------------
 * 1. `NEXT_PUBLIC_SITE_URL` — an explicit decision by whoever deployed it.
 *    Nothing should override that.
 * 2. `window.location.origin` (browser only) — the host the person is actually
 *    using. Right for preview deployments, and right when the variable was
 *    forgotten.
 * 3. `VERCEL_URL` (server only) — the deployment's own hostname. Vercel sets it
 *    without a scheme.
 * 4. `http://localhost:3000` — development. Reached only when nothing above is
 *    available, which on a server means the variable is missing.
 *
 * The one thing this must never do is return a localhost URL on a deployed
 * server, which is why (3) exists between the browser fallback and (4).
 */

const DEV_ORIGIN = "http://localhost:3000";

function normalise(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function getSiteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return normalise(configured);

  if (typeof window !== "undefined" && window.location?.origin) {
    return window.location.origin.replace(/\/+$/, "");
  }

  const vercel = process.env.VERCEL_URL?.trim();
  if (vercel) return normalise(vercel);

  return DEV_ORIGIN;
}

/** An absolute URL for a path in this application. */
export function siteUrl(path: string): string {
  return `${getSiteUrl()}${path.startsWith("/") ? path : `/${path}`}`;
}

/**
 * True when the resolved origin is a development one.
 *
 * Used to warn rather than to change behaviour: a deployed server resolving to
 * localhost means `NEXT_PUBLIC_SITE_URL` was not set, and the emails it sends
 * will be undeliverable in practice.
 */
export function isDevelopmentOrigin(): boolean {
  return getSiteUrl().startsWith("http://localhost");
}
