"use server";

import { decimal, MoneyError } from "@/db/money";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { trackPipeline } from "@/server/observability";
import { traceAction } from "@/server/trace-action";
import { revalidate } from "@/server/revalidate";
import { createInvestment } from "@/server/services/investments-write.service";
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
}

export async function createInvestmentAction(input: {
  planId: string;
  amount: string;
}): Promise<InvestResult> {
  const account = await getAuthenticatedAccount();
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
      const { investmentId } = await trackPipeline(
        {
          pipeline: "investment",
          operation: "investment.create.write",
          message: "User allocated into a plan",
          userId: account.userId,
          actor,
          subject: { type: "plan", id: input.planId },
          metadata: { amountUsdt: amount },
        },
        () =>
          createInvestment(
            { userId: account.userId, planId: input.planId, amount },
            actor,
          ),
      );
      revalidate("/", "/plans", "/wallet", "/settings/investments");
      return { ok: true, message: "Investment created.", investmentId };
    } catch (error) {
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "The allocation was not created.",
        };
      }
    },
  );
}
