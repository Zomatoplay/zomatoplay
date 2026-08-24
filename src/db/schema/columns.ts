import { numeric, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column builders.
 *
 * Money is stored as `numeric`, never as a float: USDT amounts carry up to
 * eight decimal places on-chain, and binary floating point cannot represent
 * them exactly. Drizzle's `mode: "number"` maps the driver's string back to a
 * JavaScript number so the domain types in `@/types` keep working unchanged —
 * the precision guarantee is in the storage, which is where it matters.
 */

/** A USDT amount. Signed: the ledger records debits as negatives. */
export const usdt = (name: string) =>
  numeric(name, { precision: 20, scale: 8, mode: "number" });

/** An INR amount. Two decimal places, as paise. */
export const inr = (name: string) =>
  numeric(name, { precision: 20, scale: 2, mode: "number" });

/** A percentage, e.g. an estimated return or a commission tier. */
export const percent = (name: string) =>
  numeric(name, { precision: 8, scale: 4, mode: "number" });

/** A USDT→INR conversion rate. */
export const rate = (name: string) =>
  numeric(name, { precision: 14, scale: 6, mode: "number" });

/**
 * Every timestamp is stored with a time zone and read back as a `Date`.
 * Repositories convert to the ISO strings the domain types use, so nothing
 * downstream has to think about it.
 */
export const ts = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });
