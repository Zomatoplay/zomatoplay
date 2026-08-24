import { sql } from "drizzle-orm";

/**
 * Values that need an explicit type when they appear inside a `sql` fragment.
 *
 * THE HAZARD
 * ----------
 * Drizzle applies a column's type mapper to values passed through `.values()`
 * and `.set()`. It cannot apply one to a value interpolated into a `sql`
 * template, because a fragment has no column to take the type from — the value
 * is bound as a raw parameter and handed to the driver as-is.
 *
 * For a `Date` that is fatal, and not with a Postgres error that would point at
 * the cause. postgres.js throws:
 *
 *   TypeError [ERR_INVALID_ARG_TYPE]: The "string" argument must be of type
 *   string or an instance of Buffer or ArrayBuffer. Received an instance of Date
 *
 * …wrapped in Drizzle's "Failed query", which reads like a database problem and
 * is not one. This cost an afternoon in the deposit scanner, where
 * `greatest(last_timestamp, ${date})` failed on every run while every other
 * write in the same file succeeded.
 *
 * Strings and numbers interpolate fine; it is specifically `Date` that has no
 * safe default serialisation.
 */

/** A timestamp inside a `sql` fragment: ISO text with an explicit cast. */
export function timestampValue(value: Date) {
  return sql`${value.toISOString()}::timestamptz`;
}
