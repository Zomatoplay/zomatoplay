import {
  add,
  applyPercent,
  decimal,
  isPositive,
  multiplyByRate,
  subtract,
  type Decimal,
} from "@/db/money";
import type { PlatformFinance } from "@/lib/platform-finance";

/** INR is stored `numeric(20, 2)`; there is no such thing as a fraction of a paisa. */
export const INR_SCALE = 2;

export interface ExactWithdrawalQuote {
  amountUsdt: Decimal;
  payoutRate: Decimal;
  flatFeeUsdt: Decimal;
  percentFeeUsdt: Decimal;
  totalFeeUsdt: Decimal;
  netUsdt: Decimal;
  netInr: Decimal;
}

/**
 * What a withdrawal is priced at, exactly — no JavaScript number touches a money
 * value (CLAUDE.md §17.2). `finance` is read by the caller from the database at
 * the moment of the request. `null` means the fees consume the whole amount:
 * a refusal, never a clamped zero payout presented as valid.
 */
export function exactWithdrawalQuote(
  amount: Decimal,
  finance: Pick<PlatformFinance, "flatFeeUsdt" | "percentFee" | "withdrawalRate">,
): ExactWithdrawalQuote | null {
  const payoutRate = decimal(finance.withdrawalRate);
  const flatFee = decimal(finance.flatFeeUsdt);
  const percentFee = applyPercent(amount, decimal(finance.percentFee));
  const totalFee = add(flatFee, percentFee);
  const netUsdt = subtract(amount, totalFee);
  if (!isPositive(netUsdt)) return null;
  return {
    amountUsdt: amount,
    payoutRate,
    flatFeeUsdt: flatFee,
    percentFeeUsdt: percentFee,
    totalFeeUsdt: totalFee,
    netUsdt,
    netInr: multiplyByRate(netUsdt, payoutRate, INR_SCALE),
  };
}
