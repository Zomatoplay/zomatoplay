import "server-only";

import type { NextRequest } from "next/server";

/**
 * Who may run a scheduled job.
 *
 * `CRON_SECRET` is the variable Vercel Cron sends as
 * `Authorization: Bearer <secret>`, so setting it is the whole configuration.
 *
 * **Unset, every job route refuses everybody.** These endpoints spend TronGrid
 * quota, database connections and — in the settlement job's case — move money
 * back into people's balances. An open one is a free way to exhaust the first
 * two and to drive the third at an attacker's chosen rate.
 *
 * Shared between the job routes rather than copied into each. A timing-safe
 * comparison written twice is a comparison that will eventually be written
 * once with `===`, and a plain `===` on a secret leaks its prefix to anyone
 * willing to measure.
 */
export async function isCronRequestAuthorised(
  request: NextRequest,
): Promise<boolean> {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;

  const header = request.headers.get("authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  // Length is compared first because `timingSafeEqual` throws on a mismatch,
  // and the length of a secret is not the part worth protecting.
  if (supplied.length !== expected.length) return false;

  const { timingSafeEqual } = await import("node:crypto");
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
}
