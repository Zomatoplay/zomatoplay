"use server";

import { getAuthenticatedAccount, isAccountLockedOut } from "@/server/auth/account";
import { FirebaseCredentialError, FirebaseNotConfiguredError } from "@/server/auth/firebase-admin";
import { verifyPhoneProof } from "@/server/auth/phone-proof";
import { toSafeFailure } from "@/server/errors";
import { describeError, errorDiagnostics, recordPipelineEvent } from "@/server/observability";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { revalidate } from "@/server/revalidate";
import {
  createWithdrawalPassword,
  withdrawalPasswordRefusal,
} from "@/server/services/withdrawal-password.service";
import { traceAction } from "@/server/trace-action";
import type { Actor } from "@/server/write";

/**
 * Creating a withdrawal password — once, after a fresh SMS code.
 *
 * The proof must be for THIS account's verified number and Firebase uid: a
 * code for any other phone, or one older than five minutes, is refused. The
 * password is validated against the shared rules, hashed, and never echoed,
 * logged or put in a pipeline event.
 *
 * There is no "change" or "reset" here. A customer who has forgotten theirs
 * contacts support; an operator clears it (`resetWithdrawalPasswordAction`,
 * audited), and the customer comes back here.
 */
export interface WithdrawalPasswordResult {
  ok: boolean;
  message: string;
}

const LIMIT = { attempts: 10, windowMs: 10 * 60 * 1000 };

export async function createWithdrawalPasswordAction(input: {
  proof: unknown;
  password: string;
  confirm: string;
}): Promise<WithdrawalPasswordResult> {
  return traceAction(
    { name: "withdrawal_password.create", actorType: "user", pipeline: "withdrawal" },
    async () => {
      const account = await getAuthenticatedAccount();
      if (!account) return { ok: false, message: "Your session has expired. Sign in again." };
      if (isAccountLockedOut(account.status)) {
        return { ok: false, message: `This account is ${account.status}. Contact support.` };
      }
      if (!account.phoneE164 || !account.firebaseUid) {
        return {
          ok: false,
          message: "Verify your mobile number first — a withdrawal password is confirmed by SMS.",
        };
      }

      const address = await clientAddress();
      if (!takeToken(`withdrawal-password:${account.userId}:${address}`, LIMIT.attempts, LIMIT.windowMs).allowed) {
        return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
      }

      const refusal = withdrawalPasswordRefusal(input?.password, input?.confirm, account.phoneE164);
      if (refusal) return { ok: false, message: refusal };

      try {
        const verified = await verifyPhoneProof(input?.proof, "withdrawal-password");
        if (verified.uid !== account.firebaseUid || verified.phoneE164 !== account.phoneE164) {
          recordPipelineEvent({
            pipeline: "withdrawal",
            operation: "withdrawal_password.create.refused",
            status: "ok",
            message: "SMS proof was for a different number than the account's",
            userId: account.userId,
          });
          return { ok: false, message: "That code was not for your registered mobile number." };
        }

        const actor: Actor = {
          kind: "user",
          id: account.userId,
          name: account.fullName || account.displayId,
          role: "agent",
        };
        await createWithdrawalPassword({ userId: account.userId, password: input.password }, actor);

        recordPipelineEvent({
          pipeline: "withdrawal",
          operation: "withdrawal_password.create",
          status: "ok",
          message: "Customer created a withdrawal password after SMS verification",
          userId: account.userId,
        });
        revalidate("/settings/security", "/wallet/withdraw");
        return { ok: true, message: "Withdrawal password created." };
      } catch (error) {
        if (error instanceof FirebaseCredentialError) return { ok: false, message: error.message };
        if (error instanceof FirebaseNotConfiguredError) {
          return { ok: false, message: "SMS verification is not available right now." };
        }
        const failure = toSafeFailure(error, "The withdrawal password was not saved.");
        recordPipelineEvent({
          pipeline: "withdrawal",
          operation: "withdrawal_password.create.failed",
          status: "failed",
          message: "Creating a withdrawal password failed",
          userId: account.userId,
          errorMessage: describeError(error),
          metadata: { errorCategory: failure.category, ...errorDiagnostics(error) },
        });
        return { ok: false, message: failure.message };
      }
    },
  );
}
