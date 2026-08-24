"use server";

import { revalidate } from "@/server/revalidate";

import { getAuthenticatedAccount } from "@/server/auth/account";
import { currentCorrelationId, trackPipeline } from "@/server/observability";
import { traceAction } from "@/server/trace-action";
import { startKyc, submitKyc } from "@/server/services/kyc-write.service";
import type { Actor } from "@/server/write";

/**
 * Submitting identity verification.
 *
 * WHAT THE USER CAN AND CANNOT DO
 * -------------------------------
 * A user can move their own verification from `not_started`/`in_progress`/
 * `rejected` to `pending_review`. That is the only transition this action
 * performs, and it is the only one a user is allowed to cause.
 *
 * `verified` is not reachable from here at any input. It used to be — a button
 * in the flow called `approveKyc()` and the badge turned green — which meant
 * the gate on investing and withdrawing was a client-side boolean. Approval is
 * now an operator decision, in `/admin/kyc`, written server-side and audited.
 *
 * The account comes from the session. There is no `userId` parameter, so there
 * is nothing to tamper with.
 */
export interface KycActionResult {
  ok: boolean;
  message: string;
  submissionId?: string;
  /** Ties this click to its rows in the CRM's system log. */
  correlationId?: string;
}

export async function submitKycAction(input: {
  legalName: string;
  dateOfBirth: string;
  nationality?: string;
  address?: string;
  documentType: "passport" | "national_id" | "driving_licence";
  documentNumberMasked: string;
  documentFileName: string;
  livenessCheckPassed: boolean;
}): Promise<KycActionResult> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  const legalName = input.legalName.trim();
  if (legalName.length < 2) {
    return { ok: false, message: "Enter your full legal name." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    return { ok: false, message: "Enter your date of birth." };
  }
  if (!input.livenessCheckPassed) {
    return { ok: false, message: "Complete the liveness step first." };
  }

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email,
    role: "agent",
  };

  // One correlation id for the whole submission, so "what happened when I
  // clicked Submit" is a single filter in the CRM's system log rather than a
  // reconstruction from timestamps.
  return traceAction(
    { name: "kyc.submit", actorType: "user", pipeline: "kyc" },
    async () => {
      const correlationId = currentCorrelationId();
    try {
      const { submissionId } = await trackPipeline(
        {
          pipeline: "kyc",
          operation: "kyc.submit.write",
          message: "User submitted identity verification",
          userId: account.userId,
          actor,
          metadata: { documentType: input.documentType },
        },
        () =>
          submitKyc(
            {
              userId: account.userId,
              legalName,
              dateOfBirth: input.dateOfBirth,
              nationality: input.nationality,
              address: input.address,
              documentType: input.documentType,
              documentNumberMasked: input.documentNumberMasked,
              documentFileName: input.documentFileName,
              livenessCheckPassed: input.livenessCheckPassed,
            },
            actor,
          ),
      );

      // The CRM's queue is the other half of this write. Revalidating it here
      // is what lets an operator with the console open see the new case on
      // their next navigation rather than only after a hard reload.
      revalidate("/settings/kyc", "/settings", "/", "/admin/kyc", "/admin");

      return {
        ok: true,
        message: "Submitted for review.",
        submissionId,
        correlationId,
      };
    } catch (error) {
      // Reported as a failure, never as "submitted successfully". The whole
      // point of §20: a user told their documents are in review when nothing
      // was written will wait for an answer that is never coming.
      return {
        ok: false,
        message:
          error instanceof Error ? error.message : "Could not submit verification.",
        correlationId,
      };
      }
    },
  );
}

/** Moves an untouched account to `in_progress` when the flow is opened. */
export async function startKycAction(): Promise<KycActionResult> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  return traceAction(
    { name: "kyc.start", actorType: "user", pipeline: "kyc" },
    async () => {
      await startKyc(
        { userId: account.userId },
        { kind: "user", id: account.userId, name: account.fullName, role: "agent" },
      );
      revalidate("/settings/kyc");
      return { ok: true, message: "Started." };
    },
  );
}
