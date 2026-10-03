"use server";

import { decimal, MoneyError } from "@/db/money";
import { getUsableAccount } from "@/server/auth/account";
import { toSafeFailure } from "@/server/errors";
import { trackPipeline } from "@/server/observability";
import { traceAction } from "@/server/trace-action";
import { revalidate } from "@/server/revalidate";
import {
  createInvestment,
  endOpenEndedInvestment,
} from "@/server/services/investments-write.service";
import type { Actor } from "@/server/write";

/**
 * Creating an allocation.
 *
 * WHAT THIS REPLACED
 * ------------------
 * A reducer case. `InvestSheet` called `createInvestment(plan, amount)` on the
 * in-memory store, which subtracted the amount from a JavaScript object,
 * pushed an investment and a transaction onto two arrays, and showed a receipt.
 * Nothing left the browser. A refresh undid all of it, the CRM never saw the
 * allocation, and the "available balance" the next screen validated against was
 * a number the browser had made up.
 *
 * WHAT IS TRUSTED
 * ---------------
 * The plan id and the amount, and nothing else — both re-validated server-side
 * against the plan's own limits and the account's real balance. The account
 * comes from the session; there is no `userId` parameter to tamper with.
 *
 * Every rule the sheet enforces (verification, minimum, maximum, sufficient
 * funds, frozen allocations) is enforced again in the service, because the
 * sheet is an affordance and the service is the boundary.
 */
export interface InvestResult {
  ok: boolean;
  message: string;
  investmentId?: string;
  /**
   * The rate the *server* resolved and actually applied, so the receipt shows
   * what was charged rather than what the sheet had computed for display.
   *
   * It travels back, never in: there is no rate parameter on the way to
   * `createInvestment`, which resolves the plan's ladder itself inside the
   * allocation's transaction.
   */
  appliedRatePercent?: number;
}

export async function createInvestmentAction(input: {
  planId: string;
  amount: string;
  /** The term chosen in the sheet; its rate is read server-side. */
  durationDays?: number;
}): Promise<InvestResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  let amount;
  try {
    amount = decimal(input.amount);
  } catch (error) {
    return {
      ok: false,
      message: error instanceof MoneyError ? error.message : "Enter a valid amount.",
    };
  }

  // The person acting is the account holder, recorded as such in the audit
  // entry the service writes.
  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email,
    role: "agent",
  };

  return traceAction(
    { name: "investment.create", actorType: "user", pipeline: "investment" },
    async () => {
    try {
      const { investmentId, appliedRatePercent } = await trackPipeline(
        {
          pipeline: "investment",
          operation: "investment.create.write",
          message: "User allocated into a plan",
          userId: account.userId,
          actor,
          subject: { type: "plan", id: input.planId },
          metadata: { amountUsdt: amount, durationDays: input.durationDays ?? 0 },
        },
        () =>
          createInvestment(
            {
              userId: account.userId,
              planId: input.planId,
              amount,
              durationDays:
                typeof input.durationDays === "number" ? input.durationDays : undefined,
            },
            actor,
          ),
      );
      revalidate("/", "/plans", "/wallet", "/settings/investments");
      return {
        ok: true,
        message: "Investment created.",
        investmentId,
        appliedRatePercent,
      };
    } catch (error) {
      return {
        ok: false,
        message: toSafeFailure(error, "We couldn't complete this transaction. Your balance was not changed.").message,
      };
    }
  },
  );
}

/**
 * Returning an open-ended allocation to the available balance.
 *
 * Flexible Reserve is sold as "no lock-in — funds can be returned to your
 * available balance at any time", and until now nothing did it: the settlement
 * job deliberately will not touch an open-ended allocation, and there was no
 * customer path either, so the money stayed locked for ever in the one product
 * whose selling point is that it is not.
 *
 * The account comes from the session, so there is no `userId` to tamper with,
 * and ownership is re-checked in the service against the row itself. The
 * `investmentId` is the only thing the caller supplies and the only thing it
 * could lie about — which the ownership check is there for.
 */
export interface EndAllocationResult {
  ok: boolean;
  message: string;
}

export async function endAllocationAction(input: {
  investmentId: string;
}): Promise<EndAllocationResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email,
    role: "agent",
  };

  return traceAction(
    { name: "investment.end", actorType: "user", pipeline: "investment" },
    async () => {
      try {
        const { ended, amount } = await trackPipeline(
          {
            pipeline: "investment",
            operation: "investment.end",
            message: "User returned an open-ended allocation",
            userId: account.userId,
            actor,
            subject: { type: "investment", id: input.investmentId },
          },
          () =>
            endOpenEndedInvestment(
              { investmentId: input.investmentId, userId: account.userId },
              actor,
            ),
        );

        revalidate(
          "/settings/investments",
          "/wallet",
          "/wallet/transactions",
          "/",
          "/admin/investments",
          "/admin",
        );

        return {
          ok: true,
          message: ended
            ? `${amount} USDT returned to your available balance.`
            : "That allocation had already ended.",
        };
      } catch (error) {
        return {
          ok: false,
          message: toSafeFailure(error, "The allocation could not be returned.").message,
        };
      }
    },
  );
}
