import {
  MOCK_RATE_LABEL,
  MOCK_USDT_INR_PAYOUT_RATE,
  MOCK_USDT_INR_RATE,
} from "@/constants/app";

/**
 * Single source of truth for currency conversion and formatting.
 *
 * No component performs its own conversion arithmetic — everything goes
 * through these helpers so the mock rate can be swapped for a live rates API
 * by changing `getUsdtInrRate()` alone.
 */

export interface FxRate {
  /** How many INR one USDT is worth. */
  rate: number;
  /** Human label clarifying that this is not a live market quote. */
  label: string;
  /** ISO timestamp the rate was captured. */
  asOf: string;
}

/** Fixed prototype timestamp; avoids hydration mismatches from `new Date()`. */
const RATE_AS_OF = "2026-10-02T06:00:00.000Z";

/**
 * Returns the current USDT→INR display rate.
 *
 * INTEGRATION POINT: replace the body with a real rates lookup (server-side
 * fetch, cached). The synchronous signature is intentional — callers render
 * from already-resolved data.
 */
export function getUsdtInrRate(): FxRate {
  return {
    rate: MOCK_USDT_INR_RATE,
    label: MOCK_RATE_LABEL,
    asOf: RATE_AS_OF,
  };
}

/** Rate used when quoting an INR withdrawal payout. */
export function getUsdtInrPayoutRate(): FxRate {
  return {
    rate: MOCK_USDT_INR_PAYOUT_RATE,
    label: "Quoted payout rate",
    asOf: RATE_AS_OF,
  };
}

export function usdtToInr(usdt: number, rate: number = getUsdtInrRate().rate) {
  return usdt * rate;
}

export function inrToUsdt(inr: number, rate: number = getUsdtInrRate().rate) {
  return rate === 0 ? 0 : inr / rate;
}

/* -------------------------------------------------------------------------- */
/* Formatting                                                                  */
/* -------------------------------------------------------------------------- */

const usdtFormatter = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

const usdtCompactFormatter = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 2,
});

const inrFormatter = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 0,
});

const inrPreciseFormatter = new Intl.NumberFormat("en-IN", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

export interface FormatOptions {
  /** Append the ` USDT` suffix. Default `true`. */
  withSymbol?: boolean;
  /** Use compact notation (1.2K) for large values. Default `false`. */
  compact?: boolean;
  /** Force a leading `+` for positive values. Default `false`. */
  signed?: boolean;
}

export function formatUsdt(value: number, options: FormatOptions = {}) {
  const { withSymbol = true, compact = false, signed = false } = options;
  const formatter = compact ? usdtCompactFormatter : usdtFormatter;
  const sign = signed && value > 0 ? "+" : "";
  return `${sign}${formatter.format(value)}${withSymbol ? " USDT" : ""}`;
}

export interface InrFormatOptions {
  /** Prefix with `≈` to signal an approximate conversion. Default `true`. */
  approximate?: boolean;
  /** Show paise. Default `false` (whole rupees read better on mobile). */
  precise?: boolean;
  signed?: boolean;
}

export function formatInr(value: number, options: InrFormatOptions = {}) {
  const { approximate = true, precise = false, signed = false } = options;
  const formatter = precise ? inrPreciseFormatter : inrFormatter;
  const sign = signed && value > 0 ? "+" : "";
  return `${approximate ? "≈ " : ""}${sign}₹${formatter.format(value)}`;
}

/** Convenience: format a USDT amount directly as its INR equivalent. */
export function formatUsdtAsInr(usdt: number, options: InrFormatOptions = {}) {
  return formatInr(usdtToInr(usdt), options);
}

export function formatPercent(value: number, fractionDigits = 2) {
  return `${value.toFixed(fractionDigits)}%`;
}

/** Compact USDT string for dense contexts such as chart axes. */
export function formatUsdtCompact(value: number) {
  return usdtCompactFormatter.format(value);
}
