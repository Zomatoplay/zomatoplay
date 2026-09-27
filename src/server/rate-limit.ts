import "server-only";

import { headers } from "next/headers";

/**
 * A fixed-window limiter, in process memory.
 *
 * WHAT IT IS FOR, AND WHAT IT IS NOT
 * ----------------------------------
 * Firebase already throttles the expensive thing — sending SMS — per number
 * and per project, and reCAPTCHA gates who may ask. This bounds the part that
 * is *ours*: the server actions that verify tokens and create accounts, so a
 * script cannot hammer account creation or token verification from one
 * address.
 *
 * Process-local on purpose. The deployment is one long-running Node process on
 * EC2, where a memory window is exact; with several instances each would count
 * separately, which weakens the bound without breaking anything. A shared
 * store (Redis, a table) is the upgrade when there is more than one instance —
 * noted in FUTURE_TASKS, not built speculatively.
 */

interface Window {
  count: number;
  resetAt: number;
}

const windows = new Map<string, Window>();
const MAX_KEYS = 10_000;

export function takeToken(
  key: string,
  limit: number,
  windowMs: number,
  now = Date.now(),
): { allowed: boolean; retryAfterMs: number } {
  const current = windows.get(key);
  if (!current || current.resetAt <= now) {
    if (windows.size >= MAX_KEYS) prune(now);
    windows.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (current.count >= limit) {
    return { allowed: false, retryAfterMs: current.resetAt - now };
  }
  current.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

function prune(now: number) {
  for (const [key, window] of windows) {
    if (window.resetAt <= now) windows.delete(key);
  }
  // Still full of live windows: drop the oldest rather than grow unbounded.
  if (windows.size >= MAX_KEYS) {
    const first = windows.keys().next().value;
    if (first !== undefined) windows.delete(first);
  }
}

/**
 * The caller's address, as Nginx reports it.
 *
 * `X-Real-IP` / the first `X-Forwarded-For` hop are trusted because the only
 * way to reach the Node process in production is through the Nginx in front of
 * it, which sets them (see the Nginx notes in CLAUDE.md). A forged value from
 * a client would only change which bucket that client is counted in.
 */
export async function clientAddress(): Promise<string> {
  try {
    const store = await headers();
    return (
      store.get("x-real-ip")?.trim() ||
      store.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown"
    );
  } catch {
    return "unknown";
  }
}

/** Test seam. */
export function resetRateLimits() {
  windows.clear();
}
