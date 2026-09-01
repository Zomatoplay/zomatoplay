"use server";

import { revalidate } from "@/server/revalidate";

import { getAuthenticatedAccount } from "@/server/auth/account";
import {
  describeOwnUpload,
  KycStorageError,
} from "@/server/storage/kyc-storage";
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
 *
 * NEITHER IS `livenessCheckPassed`
 * --------------------------------
 * It used to be a parameter, and the flow sent `true` because a button had been
 * pressed. An operator reads that column in the CRM as "an automated check ran
 * and passed", and no check had run. Nothing in this deployment performs
 * liveness verification, so this action records `false` and adds a risk flag
 * naming the reason — which is how the CRM already surfaces "a provider would
 * have told you something here and did not".
 *
 * THE DOCUMENT NUMBER ARRIVES ALREADY REDUCED
 * -------------------------------------------
 * The client sends four characters, not a number to be masked here. The
 * difference matters: a full identity number in a request body exists in a
 * process, possibly in an error, and possibly in a log, whatever the database
 * eventually stores. Four characters cannot leak a document number because
 * they are not one.
 */
export interface KycActionResult {
  ok: boolean;
  message: string;
  submissionId?: string;
  /** Ties this click to its rows in the CRM's system log. */
  correlationId?: string;
}

export interface KycSubmissionInput {
  legalName: string;
  dateOfBirth: string;
  nationality?: string;
  address?: string;
  documentType: "passport" | "national_id" | "driving_licence";
  /** The last four characters of the document number. Never the whole thing. */
  documentNumberLast4: string;
  documentFileName: string;
  documentByteSize: number;
  documentMimeType: string;
  selfieFileName: string;
  /**
   * Object keys in the private `kyc-documents` bucket, written by the browser
   * straight to Supabase Storage.
   *
   * Treated as claims, never as facts: `describeOwnUpload` checks each one
   * against this session's own `auth.uid()` and reads the size and content type
   * back from Storage. See `@/server/storage/kyc-storage`.
   */
  documentPath: string;
  selfiePath: string;
}

/** The document types the schema's enum accepts. Anything else is refused. */
const DOCUMENT_TYPES = new Set(["passport", "national_id", "driving_licence"]);

/** 10 MB, the limit the flow shows the person. Re-checked because the client's check is a courtesy. */
const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/**
 * A filename safe to store and to show an operator.
 *
 * Path separators and control characters are stripped rather than escaped: the
 * value is display metadata, it names no file this system will ever open, and
 * `../` in a column an operator's browser renders is a trap waiting for the day
 * a document store *is* connected and something concatenates it into a path.
 */
function safeFileName(raw: string, fallback: string): string {
  const cleaned = raw
    // Control characters, stripped rather than escaped: see above.
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/[\\/]/g, "-")
    .replace(/\.{2,}/g, ".")
    .trim()
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : fallback;
}

export async function submitKycAction(
  input: KycSubmissionInput,
): Promise<KycActionResult> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  const legalName = input.legalName.trim();
  if (legalName.length < 2) {
    return { ok: false, message: "Enter your full legal name." };
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    return { ok: false, message: "Enter your date of birth." };
  }
  if (!DOCUMENT_TYPES.has(input.documentType)) {
    return { ok: false, message: "Choose a document type." };
  }

  const last4 = input.documentNumberLast4.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (last4.length !== 4) {
    return { ok: false, message: "Enter your document number." };
  }

  const documentFileName = safeFileName(input.documentFileName, "");
  if (!documentFileName) {
    return { ok: false, message: "Attach a photo of your document." };
  }
  if (!Number.isFinite(input.documentByteSize) || input.documentByteSize <= 0) {
    return { ok: false, message: "Attach a photo of your document." };
  }
  if (input.documentByteSize > MAX_DOCUMENT_BYTES) {
    return { ok: false, message: "That document is larger than 10 MB." };
  }

  const selfieFileName = safeFileName(input.selfieFileName, "");
  if (!selfieFileName) {
    return { ok: false, message: "Take a selfie before submitting." };
  }

  /*
   * THE UPLOADS ARE VERIFIED BEFORE ANYTHING IS WRITTEN.
   *
   * Both objects must exist, belong to *this* account's folder, and be a type
   * and size the bucket accepts. The client's `documentByteSize` and
   * `documentMimeType` above are UX values from the file picker; these are the
   * numbers Storage recorded, and they are what the row keeps.
   *
   * A failure here means no submission is written at all. That is the right
   * outcome: a `pending_review` case pointing at a document nobody can open
   * wastes a reviewer's time and leaves the person waiting for an answer to a
   * question that was never asked.
   */
  const account_ = account;
  let documentObject;
  let selfieObject;
  try {
    [documentObject, selfieObject] = await Promise.all([
      describeOwnUpload(account_.authUserId, input.documentPath),
      describeOwnUpload(account_.authUserId, input.selfiePath),
    ]);
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof KycStorageError
          ? error.message
          : "Your documents could not be verified. Try uploading them again.",
    };
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
          // Named scalars only. Never the filename, never the number: this
          // metadata is free-form jsonb an operator browses (CLAUDE.md §22.2).
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
              // Composed here, from four characters. The full number was never
              // sent and does not exist in this process.
              documentNumberMasked: `•••• •••• ${last4}`,
              documentFileName,
              // From Storage, not from the browser.
              documentByteSize: documentObject.byteSize,
              documentMimeType: documentObject.contentType,
              documentPath: documentObject.path,
              selfieFileName,
              selfiePath: selfieObject.path,
              selfieByteSize: selfieObject.byteSize,
              selfieMimeType: selfieObject.contentType,
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
