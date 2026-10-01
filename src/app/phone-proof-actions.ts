"use server";

import { normalizeIndianMobile } from "@/lib/phone";
import { readCustomerSessionSecret } from "@/server/auth/customer-session";
import { issueDevChallenge } from "@/server/auth/dev-test-auth";
import { localTestCustomer, localTestOperator } from "@/server/auth/dev-test-gate";
import { localProofSubject, type PhoneProofPurpose } from "@/server/auth/phone-proof";
import { clientAddress, takeToken } from "@/server/rate-limit";

/**
 * LOCAL-ONLY: starts the test-code path for an operator sign-in or a
 * withdrawal-password step-up (`@/server/auth/dev-test-auth` explains the four
 * gates). Returns a signed, expiring challenge bound to the purpose and the
 * number; the code is checked later, by `verifyPhoneProof`, when the proof is
 * spent. Outside the gates it answers like any unavailable feature — in a
 * production build `localTest*()` is constant null and this never succeeds.
 *
 * Shared by both applications, so it lives outside either route tree.
 */
export async function startLocalPhoneProofAction(input: {
  phone: string;
  purpose: PhoneProofPurpose;
}): Promise<{ ok: boolean; message: string; challenge?: string }> {
  const purpose: PhoneProofPurpose =
    input?.purpose === "operator" ? "operator" : "withdrawal-password";
  const config = purpose === "operator" ? await localTestOperator() : await localTestCustomer();
  const secret = readCustomerSessionSecret();
  if (!config || !secret) return { ok: false, message: "That sign-in method is not available." };

  const address = await clientAddress();
  if (!takeToken(`local-proof:${address}`, 20, 10 * 60 * 1000).allowed) {
    return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
  }

  const phoneE164 = normalizeIndianMobile(String(input?.phone ?? ""));
  if (phoneE164 !== config.phoneE164) {
    return { ok: false, message: "That is not the local test number." };
  }
  return {
    ok: true,
    message: "Local test code ready.",
    challenge: issueDevChallenge(localProofSubject(purpose, phoneE164), secret, config.ttlSeconds),
  };
}
