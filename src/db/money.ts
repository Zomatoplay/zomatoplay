import { sql } from "drizzle-orm";

/**
 * Money, without floating point.
 *
 * THE PROBLEM THIS SOLVES
 * -----------------------
 * The schema stores money as `numeric`, which is exact. The columns are read
 * back as JavaScript `number` so the domain types in `@/types` — and every
 * component built against them — keep working. That is fine for *display*:
 * rendering 1250.5 is lossless.
 *
 * It is not fine for *arithmetic*. `0.1 + 0.2 !== 0.3` in float64, and a
 * balance that is repeatedly incremented in JavaScript drifts. So the rule for
 * every write in this application is:
 *
 *   **Money is never added, subtracted or compared in JavaScript.**
 *   Amounts travel as exact decimal strings, and Postgres does the arithmetic.
 *
 * `numericValue()` below is how an amount reaches a query: as a parameter cast
 * to `numeric`, never as a float that has already lost precision on the way in.
 * Balance updates are written as `balance + $1::numeric`, evaluated by the
 * database.
 *
 * Amounts arriving from a blockchain are integers in the token's smallest unit
 * (TRC-20 USDT has six decimals, so 1 USDT is 1000000). Those are converted
 * with `BigInt`, which is exact for any size, and never through `Number()`.
 */

/**
 * An exact decimal amount, as a string: `"0"`, `"1250.5"`, `"-42.000001"`.
 *
 * A branded type, so a raw string cannot be passed where an amount is meant
 * without going through one of the constructors below — which validate.
 */
export type Decimal = string & { readonly __decimal: unique symbol };

const DECIMAL_PATTERN = /^-?(?:0|[1-9]\d*)(?:\.\d+)?$/;

/** The largest scale the schema stores. Anything finer would be truncated. */
export const MAX_SCALE = 8;

export class MoneyError extends Error {}

/**
 * Validates and normalises a decimal string.
 *
 * Rejects anything that is not a plain decimal: no exponents, no `NaN`, no
 * `Infinity`, no thousands separators, no empty string. Those are exactly the
 * values that would otherwise reach Postgres and either error mid-transaction
 * or, worse, be coerced into something plausible.
 */
export function decimal(value: string | number | bigint): Decimal {
  const raw =
    typeof value === "bigint"
      ? value.toString()
      : typeof value === "number"
        ? numberToDecimalString(value)
        : value.trim();

  if (!DECIMAL_PATTERN.test(raw)) {
    throw new MoneyError(`Not an exact decimal amount: ${JSON.stringify(raw)}`);
  }

  const [, fraction = ""] = raw.split(".");
  if (fraction.length > MAX_SCALE) {
    throw new MoneyError(
      `Amount has ${fraction.length} decimal places; the schema stores ${MAX_SCALE}.`,
    );
  }

  return normalise(raw) as Decimal;
}

/**
 * Converts a `number` at the boundary — a form field, a seeded fixture.
 *
 * Deliberately narrow: it refuses anything that is not exactly representable
 * at the schema's scale, rather than silently rounding. A number is where
 * precision has already been lost, so this is the last place to notice.
 */
function numberToDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new MoneyError(`Not a finite amount: ${value}`);
  }
  const text = value.toFixed(MAX_SCALE);
  if (Number(text) !== value) {
    throw new MoneyError(`Amount ${value} cannot be represented exactly.`);
  }
  return text;
}

/** Strips trailing fractional zeros so `"1.50"` and `"1.5"` compare equal. */
function normalise(raw: string): string {
  if (!raw.includes(".")) return raw === "-0" ? "0" : raw;
  const trimmed = raw.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "-0" || trimmed === "" ? "0" : trimmed;
}

export const ZERO = decimal("0");

/* -------------------------------------------------------------------------- */
/* Token units                                                                 */
/* -------------------------------------------------------------------------- */

/**
 * Converts an on-chain integer amount to a decimal.
 *
 * TRC-20 amounts arrive as base-10 integer strings in the token's smallest
 * unit, and they can exceed `Number.MAX_SAFE_INTEGER`. `BigInt` is exact at any
 * size; `Number()` is not, and a token with 18 decimals would lose the low
 * digits before anything else got a chance to look at them.
 */
export function fromTokenUnits(units: string, decimals: number): Decimal {
  if (!/^\d+$/.test(units.trim())) {
    throw new MoneyError(`Not an integer token amount: ${JSON.stringify(units)}`);
  }
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30) {
    throw new MoneyError(`Implausible token decimals: ${decimals}`);
  }

  const value = BigInt(units.trim());
  if (decimals === 0) return decimal(value.toString());

  // `BigInt(10) ** …` rather than a `10n` literal: the project targets ES2017,
  // where BigInt literals are not available but the type is.
  const scale = BigInt(10) ** BigInt(decimals);
  const whole = value / scale;
  const padded = (value % scale).toString().padStart(decimals, "0");

  // Trailing zeros are dropped before the scale check, not after. An
  // eighteen-decimal token reporting 2.500000000000000000 is the amount 2.5,
  // and rejecting it for having eighteen decimal places would be wrong. What
  // remains after trimming is the real precision — and if *that* is finer than
  // the schema stores, `decimal()` refuses, which is correct: the alternative
  // is silently banking a rounded figure.
  const fraction = padded.replace(/0+$/, "");

  return decimal(fraction ? `${whole}.${fraction}` : whole.toString());
}

/** The inverse, for building an amount to send. Exact, via `BigInt`. */
export function toTokenUnits(amount: Decimal, decimals: number): string {
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = (negative ? amount.slice(1) : amount).split(".");
  if (fraction.length > decimals) {
    throw new MoneyError(
      `Amount ${amount} has more precision than the token's ${decimals} decimals.`,
    );
  }
  const units = BigInt(whole + fraction.padEnd(decimals, "0"));
  return (negative ? -units : units).toString();
}

/* -------------------------------------------------------------------------- */
/* Comparison                                                                  */
/* -------------------------------------------------------------------------- */

/** Compares two amounts exactly. Returns -1, 0 or 1. */
export function compare(a: Decimal, b: Decimal): -1 | 0 | 1 {
  const scaled = (value: Decimal) => {
    const negative = value.startsWith("-");
    const [whole, fraction = ""] = (negative ? value.slice(1) : value).split(".");
    const units = BigInt(whole + fraction.padEnd(MAX_SCALE, "0"));
    return negative ? -units : units;
  };
  const left = scaled(a);
  const right = scaled(b);
  return left < right ? -1 : left > right ? 1 : 0;
}

export const isPositive = (amount: Decimal) => compare(amount, ZERO) > 0;
export const isNegative = (amount: Decimal) => compare(amount, ZERO) < 0;

/** Flips the sign. Used to turn a credit into the debit that mirrors it. */
export function negate(amount: Decimal): Decimal {
  if (compare(amount, ZERO) === 0) return ZERO;
  return (amount.startsWith("-") ? amount.slice(1) : `-${amount}`) as Decimal;
}

/* -------------------------------------------------------------------------- */
/* Reaching the database                                                       */
/* -------------------------------------------------------------------------- */

/**
 * An amount as a query parameter, cast to `numeric`.
 *
 * The typed columns declare `number`, because that is what reads return. This
 * carries the exact decimal instead, and the cast tells Postgres to parse it as
 * a number rather than compare it as text. Every money value written by this
 * application goes through here.
 */
export function numericValue(amount: Decimal) {
  return sql<number>`${amount}::numeric`;
}

/** Reads a money column back as an exact decimal rather than a float. */
export function decimalFrom(value: number | string | null | undefined): Decimal {
  if (value === null || value === undefined) return ZERO;
  return decimal(typeof value === "string" ? value : value);
}

/* -------------------------------------------------------------------------- */
/* Splitting a total across periods                                           */
/* -------------------------------------------------------------------------- */

/**
 * Splits `total` into `parts` non-negative shares that sum to exactly `total`,
 * with no fractional unit created or lost.
 *
 * Used to divide an allocation's total scheduled profit across its reward
 * periods (CLAUDE.md §10a): non-compounding profit needs every period's amount
 * to be a fixed share of the *original* total, and the shares still need to
 * add up to it exactly. Floating point cannot promise that — `1000 / 3` three
 * times does not sum back to `1000` in float64 — so this scales the amount to
 * an integer count of the schema's smallest unit (1e-8 USDT) with `BigInt`,
 * which is exact at any size, and does the division there.
 *
 * Each of the first `parts - 1` shares is `total ÷ parts`, truncated toward
 * zero at the schema's scale; the last share is whatever is left, which is why
 * it is not always exactly equal to the others — the same shape a bank uses
 * when splitting a bill that does not divide evenly. `parts` must be a
 * positive integer; the caller decides how many periods a term has.
 */
export function splitEvenly(total: Decimal, parts: number): Decimal[] {
  if (!Number.isInteger(parts) || parts < 1) {
    throw new MoneyError(`Cannot split an amount into ${parts} parts.`);
  }
  const totalUnits = toUnits(total);
  const share = totalUnits / BigInt(parts);
  const shares: Decimal[] = [];
  for (let i = 0; i < parts - 1; i += 1) {
    shares.push(fromUnits(share));
  }
  shares.push(fromUnits(totalUnits - share * BigInt(parts - 1)));
  return shares;
}

/** Scales an exact decimal string to an integer count of `1e-MAX_SCALE` units. */
function toUnits(amount: Decimal): bigint {
  const negative = amount.startsWith("-");
  const [whole, fraction = ""] = (negative ? amount.slice(1) : amount).split(".");
  const units = BigInt(whole + fraction.padEnd(MAX_SCALE, "0"));
  return negative ? -units : units;
}

/**
 * An exact amount scaled by a percentage (`percent` = `"8.5"` meaning 8.5%),
 * with no floating point at any point in the computation.
 *
 * Used wherever a percentage from a `percent` column (`numeric(8,4)`) needs to
 * be applied to a `Decimal` amount — the reward-schedule stamp at
 * `createInvestment` needs exactly this, because `value * percent / 100` in
 * JavaScript is a float64 multiply-then-divide on values that came from exact
 * columns, and the result is almost never itself exactly representable at the
 * schema's 8-decimal scale — `decimal()` would correctly refuse most of them.
 *
 * Truncated toward zero at the schema's scale, the same simple rule
 * `splitEvenly()` uses for its non-final shares. This is not required to
 * match, digit for digit, whatever Postgres's own `numeric` arithmetic
 * produces for the same expression elsewhere (a column computed directly in
 * SQL is still the value of record) — it only has to be exact and
 * deterministic in its own right, which truncation is.
 */
export function applyPercent(amount: Decimal, percent: Decimal): Decimal {
  const PERCENT_SCALE = 4;
  const negative = percent.startsWith("-");
  const [whole, fraction = ""] = (negative ? percent.slice(1) : percent).split(".");
  if (fraction.length > PERCENT_SCALE) {
    throw new MoneyError(`Percent ${percent} has more than ${PERCENT_SCALE} decimal places.`);
  }
  const magnitude = BigInt(whole + fraction.padEnd(PERCENT_SCALE, "0"));
  const percentUnits = negative ? -magnitude : magnitude;

  // amount = amountUnits / 10^MAX_SCALE, percent = percentUnits / 10^PERCENT_SCALE.
  // (amount * percent / 100) expressed back in amount-scale units reduces to
  // amountUnits * percentUnits / 10^(PERCENT_SCALE + 2).
  const resultUnits =
    (toUnits(amount) * percentUnits) / BigInt(10) ** BigInt(PERCENT_SCALE + 2);
  return fromUnits(resultUnits);
}

/** The inverse of `toUnits`. */
function fromUnits(units: bigint): Decimal {
  const negative = units < BigInt(0);
  const abs = negative ? -units : units;
  const digits = abs.toString().padStart(MAX_SCALE + 1, "0");
  const whole = digits.slice(0, -MAX_SCALE);
  const fraction = digits.slice(-MAX_SCALE);
  return decimal(`${negative ? "-" : ""}${whole}.${fraction}`);
}
