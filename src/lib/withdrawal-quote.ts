import type { PlatformFinance } from "@/lib/platform-finance";
import type { WithdrawalQuote } from "@/types";

/**
 * The withdrawal quote as the screen shows it, in ordinary numbers.
 *
 * Display only: it lets a person see the arithmetic before they commit. What is
 * stored is computed again, exactly, on the server from the same settings
 * (`@/server/withdrawal-quote`), and a test holds the two to the same answer.
 */
export function displayWithdrawalQuote(
  amountUsdt: number,
  finance: Pick<PlatformFinance, "flatFeeUsdt" | "percentFee" | "withdrawalRate">,
): WithdrawalQuote {
  const percentFeeUsdt = (amountUsdt * finance.percentFee) / 100;
  const totalFeeUsdt = finance.flatFeeUsdt + percentFeeUsdt;
  const netUsdt = Math.max(amountUsdt - totalFeeUsdt, 0);
  return {
    amountUsdt,
    flatFeeUsdt: finance.flatFeeUsdt,
    percentFeeUsdt,
    totalFeeUsdt,
    netUsdt,
    rate: finance.withdrawalRate,
    netInr: truncatePaise(netUsdt * finance.withdrawalRate),
  };
}

/**
 * Whole paise, truncated toward zero — the rule the server's exact arithmetic
 * applies (`multiplyByRate`), so the payout on screen is the payout stored,
 * not one paisa more. The `toFixed` first removes binary-float noise
 * (48.44 × 100.4 computes as 4863.3759999…) before the cut.
 */
function truncatePaise(inr: number): number {
  return Math.floor(Number((inr * 100).toFixed(6))) / 100;
}
