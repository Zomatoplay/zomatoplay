/**
 * Surviving a temporarily unhealthy pooler endpoint.
 *
 * THE FAILURE THIS EXISTS FOR
 * ---------------------------
 * `aws-0-ap-northeast-2.pooler.supabase.com` resolves to three A records.
 * Measured, repeatedly: one of them accepts the TCP connection and then never
 * completes the Postgres startup handshake, so the attempt dies at
 * `connect_timeout` while the other two answer in ~2.5s with the same
 * credentials, the same TLS and the same pool settings.
 *
 * Which endpoint is the broken one **changes over time**. On 2026-08-24 it was
 * `15.164.120.176` (CONNECT_TIMEOUT 3/3); re-probed during this work, that same
 * address answered 4/4 and the fault had moved. That is the whole reason this
 * is a retry and not a pinned address: pinning would hard-code today's healthy
 * endpoint and become tomorrow's outage, and it would also throw away the
 * pooler's load balancing.
 *
 * WHY A RETRY ACTUALLY ROUTES AROUND IT
 * -------------------------------------
 * postgres.js resolves the hostname per connection attempt, and the resolver
 * rotates the three A records. So a second attempt is a *different endpoint*
 * with high probability — not the same doomed one again. That is what makes a
 * small retry budget effective here rather than merely hopeful.
 *
 * WHAT IS DELIBERATELY NOT RETRIED
 * --------------------------------
 * Everything except a failure to *establish a connection*. A query that
 * reached the server and failed there — a constraint violation, a syntax
 * error, a permission problem, a statement timeout — is a permanent error and
 * is re-thrown untouched on the first attempt. Retrying those would hide real
 * bugs behind a delay and turn one broken page into three.
 *
 * Writes are not retried at all. See `isTransientConnectionError` and the note
 * in `@/server/write`: this module is wired into reads only, because a
 * mutation that failed *after* its statements reached the server may well have
 * committed, and replaying it would double it.
 */

/** Driver and OS codes that mean "the connection never got established". */
const TRANSIENT_CODES = new Set([
  // postgres.js: `connect_timeout` elapsed before the handshake completed.
  // This is the exact code the broken pooler endpoint produces.
  "CONNECT_TIMEOUT",
  // The socket died under us, or was reaped by the pooler on its side.
  "ECONNRESET",
  "EPIPE",
  "ETIMEDOUT",
  "ECONNREFUSED",
  "CONNECTION_CLOSED",
  "CONNECTION_ENDED",
  "CONNECTION_DESTROYED",
  // Transient resolver failures. `ENOTFOUND` is deliberately absent: a name
  // that does not resolve is usually a misconfiguration, and retrying it just
  // delays a clear error.
  "EAI_AGAIN",
  // Postgres SQLSTATE 57P03 (cannot_connect_now) and 57P01 (admin shutdown):
  // the server is up but refusing, which is the definition of worth retrying.
  "57P01",
  "57P03",
]);

interface DriverError {
  name?: unknown;
  code?: unknown;
  message?: unknown;
  cause?: unknown;
}

/**
 * Whether a failure is a connection problem that a fresh attempt could survive.
 *
 * Matches on the driver's `code` rather than message text: codes are a stable
 * interface across driver versions and messages are not.
 */
export function isTransientConnectionError(error: unknown, depth = 0): boolean {
  if (!error || depth > 4) return false;
  const e = error as DriverError;
  const code = typeof e.code === "string" ? e.code : "";

  if (TRANSIENT_CODES.has(code)) return true;
  // SQLSTATE class 08 — connection exception, every member of which describes a
  // connection that failed rather than a statement that was rejected.
  if (/^08/.test(code)) return true;

  // Drizzle wraps driver errors, undici wraps socket errors. The real reason is
  // usually one level down.
  if (e.cause && e.cause !== error) {
    return isTransientConnectionError(e.cause, depth + 1);
  }
  return false;
}

export interface RetryOptions {
  /**
   * Extra attempts after the first. Two means three tries in total, which with
   * three A records is enough to meet a healthy endpoint with high probability
   * while keeping the worst case bounded.
   */
  retries?: number;
  /**
   * Total wall-clock budget across every attempt, including backoff.
   *
   * A retry count alone is not a bound: three attempts against an endpoint that
   * hangs for the full `connect_timeout` is three times that timeout. The
   * budget is what guarantees a caller fails in a knowable time rather than a
   * multiplied one, and it is checked *before* committing to another attempt.
   */
  budgetMs?: number;
  /** Called before each retry. Used to record the attempt without importing a logger here. */
  onRetry?: (info: { attempt: number; error: unknown; delayMs: number }) => void;
}

export const DEFAULT_RETRIES = Number(process.env.DATABASE_CONNECT_RETRIES ?? 2);
export const DEFAULT_RETRY_BUDGET_MS = Number(
  process.env.DATABASE_RETRY_BUDGET_MS ?? 12_000,
);

/**
 * Backoff with jitter.
 *
 * Short, because the thing being waited out is endpoint selection rather than
 * load: there is no point being polite to a pooler that answered another
 * caller in 2.5s. The jitter matters more than the delay — several renders
 * failing at once must not retry in lockstep and arrive as a second thundering
 * herd.
 */
function backoffMs(attempt: number): number {
  const base = 120 * 2 ** (attempt - 1);
  return Math.round(base + Math.random() * base);
}

/**
 * Runs a **read**, retrying only transient connection failures.
 *
 * The operation must be idempotent. Nothing here inspects what it does, so
 * wiring a mutation through this would silently make double-writes possible —
 * which is why the only callers are the read seams in `@/server/database` and
 * `@/server/services/account.service`.
 */
export async function withConnectionRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const retries = options.retries ?? DEFAULT_RETRIES;
  const budgetMs = options.budgetMs ?? DEFAULT_RETRY_BUDGET_MS;
  const startedAt = Date.now();

  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;

      // A permanent error is re-thrown immediately and untouched. Hiding a
      // constraint violation behind three attempts helps nobody.
      if (!isTransientConnectionError(error)) throw error;
      if (attempt === retries) break;

      const delayMs = backoffMs(attempt + 1);
      const spent = Date.now() - startedAt;
      // Only retry if there is room for the wait *and* a plausible attempt
      // after it. Starting an attempt the budget cannot contain just moves the
      // failure later.
      if (spent + delayMs >= budgetMs) break;

      options.onRetry?.({ attempt: attempt + 1, error, delayMs });
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }

  // The last transient error, unwrapped by nothing and unhidden. A caller that
  // sees this has genuinely exhausted the budget, and that is a real outage
  // rather than a blip.
  throw lastError;
}
