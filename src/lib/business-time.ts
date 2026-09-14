/**
 * The one place this application says what "a business day" means.
 *
 * WHY A BUSINESS TIMEZONE EXISTS AT ALL, AND WHY IT IS IST
 * --------------------------------------------------------
 * Nothing in this codebase had one before, and that was correct while nothing
 * was scheduled to a wall clock: every stored timestamp is UTC, and every
 * displayed date goes through the UTC-pinned formatters in `@/utils/format`
 * precisely so a render cannot depend on where the reader is (CLAUDE.md §11).
 * That rule is unchanged and this does not weaken it.
 *
 * WHY IT LIVES IN `lib/` AND NOT UNDER `server/`
 * -----------------------------------------------
 * It is pure date arithmetic with no database, no session and no Next import,
 * and both sides need it: the release job computes the boundary, and the CRM's
 * commission table renders it. `lib/` is the shared ground both applications
 * may read (CLAUDE.md §15.1); a `server-only` copy would have forced the
 * screen to keep its own duplicate of the offset, which is exactly how two
 * parts of a system come to disagree about what midnight is.
 *
 * What needed a timezone is the *referral release schedule*, because "release
 * at midnight" is a statement about a calendar and a calendar needs a place.
 * The place is India:
 *
 *   - withdrawals pay out in **INR**, to **Indian bank accounts**, quoted at an
 *     INR payout rate (CLAUDE.md §9);
 *   - every INR figure in both applications is formatted `en-IN`, in lakh and
 *     crore grouping, deliberately;
 *   - `/settings/language` lists Indian locales as the intended set.
 *
 * So the business already runs on an Indian calendar everywhere it touches
 * money leaving the platform, and a payout schedule on any other calendar
 * would be the odd one out.
 *
 * WHY THE OFFSET IS A CONSTANT AND NOT A TIMEZONE DATABASE LOOKUP
 * ---------------------------------------------------------------
 * India has observed a single offset, UTC+05:30, with **no daylight saving**,
 * since 1945. There is nothing for a DST rule to do, and `Intl` would pull a
 * timezone database into a path that runs on a schedule and must be trivially
 * predictable. A jurisdiction that *does* observe DST would need `Intl`
 * instead — if this constant is ever pointed somewhere else, that is the first
 * thing to change, not the number.
 */

/** The business calendar. Named, so nothing has to infer it from the offset. */
export const BUSINESS_TIMEZONE = "Asia/Kolkata";

/** Minutes ahead of UTC. `+05:30`. Fixed year-round; India observes no DST. */
export const BUSINESS_UTC_OFFSET_MINUTES = 330;

/** For a schedule expression: `00:00 IST` is `18:30` the previous day, UTC. */
export const BUSINESS_MIDNIGHT_UTC_HOUR = 18;
export const BUSINESS_MIDNIGHT_UTC_MINUTE = 30;

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

/**
 * Midnight, business time, `daysAhead` business days after the one `at` falls
 * in — returned as the UTC instant it corresponds to.
 *
 * `daysAhead: 0` is the start of the business day `at` is already inside, so
 * an instant at 14:00 IST maps back to 00:00 IST the same morning — which is
 * in the past. Callers wanting "the next boundary" pass at least 1.
 *
 * Worked, because the arithmetic is easy to get backwards: an accrual at
 * 2026-09-13T20:00Z is 2026-09-14T01:30 IST, so its business day is the 14th;
 * with `daysAhead: 3` the result is 2026-09-17T00:00 IST, which is
 * 2026-09-16T18:30Z.
 */
export function businessMidnightUtc(at: Date, daysAhead: number): Date {
  const shifted = at.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE;
  // Floor to the start of the business day, in shifted (business-local) terms.
  const startOfBusinessDay = Math.floor(shifted / MS_PER_DAY) * MS_PER_DAY;
  const target = startOfBusinessDay + daysAhead * MS_PER_DAY;
  return new Date(target - BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE);
}

/**
 * A timestamp written the way a person on the business calendar reads it:
 * `14 Sep 2026, 00:00 IST`.
 *
 * The suffix is not decoration. The system log already learned this lesson the
 * expensive way — an operator in India read a UTC-pinned clock as local and
 * reported the log as wrong (CLAUDE.md §11) — and a release *date* is exactly
 * the kind of value somebody will compare against their own watch.
 */
export function formatBusinessDateTime(value: Date | string): string {
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  // Shift into business time and then read the UTC fields, so the output never
  // depends on the machine rendering it. Same technique the UTC-pinned
  // formatters use, with an offset applied first.
  const shifted = new Date(
    date.getTime() + BUSINESS_UTC_OFFSET_MINUTES * MS_PER_MINUTE,
  );
  const day = shifted.getUTCDate();
  const month = MONTHS[shifted.getUTCMonth()];
  const year = shifted.getUTCFullYear();
  const hours = String(shifted.getUTCHours()).padStart(2, "0");
  const minutes = String(shifted.getUTCMinutes()).padStart(2, "0");
  return `${day} ${month} ${year}, ${hours}:${minutes} IST`;
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
] as const;
