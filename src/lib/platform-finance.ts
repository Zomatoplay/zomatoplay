import {
  MIN_WITHDRAWAL_USDT,
  MOCK_RATE_LABEL,
  MOCK_USDT_INR_PAYOUT_RATE,
  MOCK_USDT_INR_RATE,
  WITHDRAWAL_FEE_PERCENT,
  WITHDRAWAL_FEE_USDT,
} from "@/constants/app";

/**
 * The platform's administrator-controlled money settings, resolved.
 *
 * Stored as jsonb in `platform_settings.currency` / `.withdrawals`, so any
 * field may be missing or wrong. Everything customer-facing and every quote
 * goes through `resolvePlatformFinance`, which substitutes the initial value
 * for anything unusable rather than quoting a zero rate or a negative fee.
 * Pure and dependency-free so the browser, the server and the tests share one
 * definition. Historical records are never recomputed from this: a withdrawal
 * stores the rate and fees it was quoted at.
 */
export interface PlatformFinance {
  /** INR per USDT for deposits and every INR figure shown. */
  depositRate: number;
  /** INR per USDT an INR withdrawal is paid out at. */
  withdrawalRate: number;
  /** Flat fee per withdrawal, in USDT. */
  flatFeeUsdt: number;
  /** Additional fee as a percentage of the amount (0 = none). */
  percentFee: number;
  minimumWithdrawalUsdt: number;
  rateLabel: string;
}

export const DEFAULT_PLATFORM_FINANCE: PlatformFinance = {
  depositRate: MOCK_USDT_INR_RATE,
  withdrawalRate: MOCK_USDT_INR_PAYOUT_RATE,
  flatFeeUsdt: WITHDRAWAL_FEE_USDT,
  percentFee: WITHDRAWAL_FEE_PERCENT,
  minimumWithdrawalUsdt: MIN_WITHDRAWAL_USDT,
  rateLabel: MOCK_RATE_LABEL,
};

export interface StoredFinanceSections {
  currency?: { displayRate?: unknown; payoutRate?: unknown; rateLabel?: unknown } | null;
  withdrawals?: { flatFeeUsdt?: unknown; percentFee?: unknown; minimumUsdt?: unknown } | null;
}

const RATE_MAX = 10_000;

function decimalPlaces(value: number): number {
  const text = String(value);
  const dot = text.indexOf(".");
  return dot < 0 || text.includes("e") ? (text.includes("e") ? 99 : 0) : text.length - dot - 1;
}

/** A conversion rate: finite, > 0, ≤ 10,000, at most 2 decimal places. */
export function isValidRate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value > 0 &&
    value <= RATE_MAX &&
    decimalPlaces(value) <= 2
  );
}

/** A flat fee: finite, 0 ≤ fee ≤ 1,000 USDT, at most 6 decimal places. */
export function isValidFlatFee(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1000 &&
    decimalPlaces(value) <= 6
  );
}

/** A percentage fee: 0 ≤ p ≤ 20, at most 2 decimal places. */
export function isValidPercentFee(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 20 &&
    decimalPlaces(value) <= 2
  );
}

export function resolvePlatformFinance(
  stored: StoredFinanceSections | null | undefined,
): PlatformFinance {
  const d = DEFAULT_PLATFORM_FINANCE;
  const minimum = stored?.withdrawals?.minimumUsdt;
  const label = stored?.currency?.rateLabel;
  return {
    depositRate: isValidRate(stored?.currency?.displayRate) ? stored.currency.displayRate : d.depositRate,
    withdrawalRate: isValidRate(stored?.currency?.payoutRate) ? stored.currency.payoutRate : d.withdrawalRate,
    flatFeeUsdt: isValidFlatFee(stored?.withdrawals?.flatFeeUsdt) ? stored.withdrawals.flatFeeUsdt : d.flatFeeUsdt,
    percentFee: isValidPercentFee(stored?.withdrawals?.percentFee) ? stored.withdrawals.percentFee : d.percentFee,
    minimumWithdrawalUsdt:
      typeof minimum === "number" && Number.isFinite(minimum) && minimum > 0 && minimum <= 1_000_000
        ? minimum
        : d.minimumWithdrawalUsdt,
    rateLabel: typeof label === "string" && label.trim() && label.length <= 80 ? label.trim() : d.rateLabel,
  };
}

/** Why a settings save is refused, or null. Applied by the admin action. */
export function financeSettingsRefusal(input: {
  displayRate: unknown;
  payoutRate: unknown;
  flatFeeUsdt: unknown;
  percentFee: unknown;
}): string | null {
  if (!isValidRate(input.displayRate)) {
    return "The deposit rate must be a number above 0 with at most 2 decimal places.";
  }
  if (!isValidRate(input.payoutRate)) {
    return "The withdrawal rate must be a number above 0 with at most 2 decimal places.";
  }
  if (!isValidFlatFee(input.flatFeeUsdt)) {
    return "The withdrawal fee must be between 0 and 1,000 USDT.";
  }
  if (!isValidPercentFee(input.percentFee)) {
    return "The percentage fee must be between 0 and 20.";
  }
  return null;
}
