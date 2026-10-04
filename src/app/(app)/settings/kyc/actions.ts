"use server";

import { revalidate } from "@/server/revalidate";

import { getUsableAccount } from "@/server/auth/account";
import { KycStorageError } from "@/server/storage/kyc-storage";
import {
  issueKycUploadTarget,
  kycUploadModeFor,
  verifyOwnKycUpload,
} from "@/server/storage/kyc-document-store";
import {
  currentCorrelationId,
  describeError,
  errorDiagnostics,
  recordPipelineEvent,
  trackPipeline,
} from "@/server/observability";
import { toSafeFailure } from "@/server/errors";
import { traceAction } from "@/server/trace-action";
import {
  kycFileRefusal,
  kycFileReferencesRefusal,
} from "@/server/services/kyc-policy";
import {
  KycError,
  startKyc,
  submitKyc,
  type KycUploadedDocument,
} from "@/server/services/kyc-write.service";
import {
  dateOfBirthRefusal,
  documentNumberRefusal,
  isKycDocumentType,
  maskDocumentNumber,
  type KycDocumentType,
} from "@/lib/kyc-identity";
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
 * THE DOCUMENT NUMBER IS VALIDATED HERE, AND ONLY ITS MASK IS KEPT
 * ----------------------------------------------------------------
 * It used to arrive as four characters, which kept the number out of the
 * process but meant no server could check it — any four characters were a
 * "document number". The full number now arrives (over TLS), is checked
 * against its type's format (`@/lib/kyc-identity`, the same rules the form
 * uses), and is reduced to its mask before anything is written. It is never
 * put in a log, a pipeline event, an error or a response: the metadata below
 * names its type only.
 *
 * UNEXPECTED FAILURES CARRY A REFERENCE
 * -------------------------------------
 * A refusal the person can fix (a field, "already under review") is shown as
 * is. Anything else is described generically with the request's correlation
 * id as `reference`, which is the key to the real error in the system log.
 */
export interface KycActionResult {
  ok: boolean;
  message: string;
  /** Set on unexpected failures only: what support searches the system log for. */
  reference?: string;
  submissionId?: string;
  /** Ties this click to its rows in the CRM's system log. */
  correlationId?: string;
}

export interface KycSubmissionInput {
  legalName: string;
  dateOfBirth: string;
  nationality?: string;
  address?: string;
  documentType: KycDocumentType;
  /** The whole number as typed; validated, masked, and never stored or logged. */
  documentNumber: string;

  /*
   * BOTH FILES ARE OPTIONAL (`@/server/services/kyc-policy`), but one that is
   * referenced must be a real upload.
   *
   * Each is a storage key the server issued for this account and this kind of
   * file, plus the display filename. The key is checked against the session's
   * own prefix and kind, then read back from storage before any row claims the
   * file exists — the browser's size and type are only a first refusal. A
   * screen that merely *showed* a file as selected produces no key, and is
   * refused here.
   */
  documentFileName?: string;
  documentByteSize?: number;
  documentMimeType?: string;
  /** Object key in the private `kyc-documents` bucket, written by the browser. */
  documentPath?: string;
  selfieFileName?: string;
  selfiePath?: string;
}

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
  /*
   * THE WHOLE THING IS INSIDE THE TRACE, INCLUDING VALIDATION.
   *
   * It used to validate and verify the uploads *before* `traceAction`, so
   * every failure in that half recorded nothing at all. The reported "the KYC
   * page shows an error at submission" left no `kyc.*` rows in
   * `pipeline_events` for exactly that reason: the failures were happening in
   * the untraced prologue. A submission that fails now says so in the system
   * log, with its category and its correlation id.
   */
  return traceAction(
    { name: "kyc.submit", actorType: "user", pipeline: "kyc" },
    () => resolveKycSubmission(input),
  );
}

async function resolveKycSubmission(
  input: KycSubmissionInput,
): Promise<KycActionResult> {
  const correlationId = currentCorrelationId();

  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again.", correlationId };

  /* ---------------------------------------------------------------- */
  /* Identity fields — required at every policy setting                */
  /* ---------------------------------------------------------------- */
  const legalName = String(input.legalName ?? "").trim();
  if (legalName.length < 2 || legalName.length > 120) {
    return reject("Enter your full legal name.", correlationId);
  }
  const dateOfBirth = String(input.dateOfBirth ?? "");
  const dobRefusal = dateOfBirthRefusal(dateOfBirth);
  if (dobRefusal) return reject(dobRefusal, correlationId);
  if (!isKycDocumentType(input.documentType)) {
    return reject("Choose a document type.", correlationId);
  }
  const documentNumber = String(input.documentNumber ?? "");
  const numberRefusal = documentNumberRefusal(input.documentType, documentNumber);
  if (numberRefusal) return reject(numberRefusal, correlationId);

  // The mobile number is required, and it must be the one verified by OTP.
  if (!account.phoneE164) {
    return reject("Verify your mobile number before submitting.", correlationId);
  }

  /* ---------------------------------------------------------------- */
  /* Files — each optional, but a referenced file must be a real upload */
  /* ---------------------------------------------------------------- */
  const malformed = kycFileReferencesRefusal(input);
  if (malformed) return reject(malformed, correlationId);
  const hasDocument = Boolean(input.documentPath?.trim());
  const hasSelfie = Boolean(input.selfiePath?.trim());

  // The browser's own figures, refused early when they are already wrong.
  // The authoritative numbers come back from storage below.
  if (hasDocument && (input.documentByteSize !== undefined || input.documentMimeType !== undefined)) {
    const claimed = kycFileRefusal("document", {
      contentType: String(input.documentMimeType ?? ""),
      byteSize: Number(input.documentByteSize),
    });
    if (claimed) return reject(claimed, correlationId);
  }

  /*
   * EVERY UPLOAD IS VERIFIED BEFORE ANYTHING IS WRITTEN.
   *
   * Each object must exist, belong to *this* account's prefix for *its* kind,
   * and be a type and size the policy accepts — as storage recorded them, not
   * as the file picker reported. A failure refuses the whole submission.
   */
  let document: KycUploadedDocument | null = null;
  let selfie: KycUploadedDocument | null = null;
  try {
    const [documentObject, selfieObject] = await Promise.all([
      hasDocument ? verifyOwnKycUpload(account, String(input.documentPath), "document") : null,
      hasSelfie ? verifyOwnKycUpload(account, String(input.selfiePath), "selfie") : null,
    ]);

    const refusal =
      (documentObject ? kycFileRefusal("document", documentObject) : null) ??
      (selfieObject ? kycFileRefusal("selfie", selfieObject) : null);
    if (refusal) return reject(refusal, correlationId);

    if (documentObject) {
      document = {
        fileName: safeFileName(input.documentFileName ?? "", "document"),
        path: documentObject.path,
        byteSize: documentObject.byteSize,
        mimeType: documentObject.contentType,
        storageBackend: documentObject.backend,
      };
    }
    if (selfieObject) {
      selfie = {
        fileName: safeFileName(input.selfieFileName ?? "", "selfie"),
        path: selfieObject.path,
        byteSize: selfieObject.byteSize,
        mimeType: selfieObject.contentType,
        storageBackend: selfieObject.backend,
      };
    }
  } catch (error) {
    recordPipelineEvent({
      pipeline: "kyc",
      operation: "kyc.submit.upload_rejected",
      status: "failed",
      message: "An uploaded document could not be verified",
      userId: account.userId,
      errorMessage: describeError(error),
    });
    return error instanceof KycStorageError
      ? { ok: false, correlationId, message: error.message }
      : {
          ok: false,
          correlationId,
          reference: correlationId,
          message: "Your photos could not be checked. Remove them and submit, or try again.",
        };
  }

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: account.fullName || account.email,
    role: "agent",
  };

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
        metadata: {
          documentType: input.documentType,
          documentBackend: document?.storageBackend ?? "none",
          documentBytes: document?.byteSize ?? 0,
          selfieBytes: selfie?.byteSize ?? 0,
        },
      },
      () =>
        submitKyc(
          {
            userId: account.userId,
            legalName,
            dateOfBirth,
            nationality: input.nationality,
            address: input.address,
            documentType: input.documentType,
            // Only the mask leaves this function; the full number is dropped.
            documentNumberMasked: maskDocumentNumber(documentNumber),
            document,
            selfie,
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
    /*
     * Reported as a failure, never as "submitted successfully" — a person told
     * their documents are in review when nothing was written will wait for an
     * answer that is never coming.
     *
     * `toSafeFailure` is what stops a database fault being described to the
     * person as though they had filled the form in wrongly. `KycError` is on
     * its allowlist, so the real product refusals ("a submission is already
     * under review") still reach them verbatim.
     */
    const failure = toSafeFailure(error, "Could not submit verification.");
    recordPipelineEvent({
      pipeline: "kyc",
      operation: "kyc.submit.rejected",
      status: "failed",
      message: "The submission was not written",
      userId: account.userId,
      errorMessage: describeError(error),
      metadata: { errorCategory: failure.category, ...errorDiagnostics(error) },
    });
    // A refusal written for the person (KycError) is shown as is; anything
    // else gets the generic sentence and a reference into the system log.
    return failure.category === "VALIDATION_ERROR" || error instanceof KycError
      ? { ok: false, message: failure.message, correlationId }
      : {
          ok: false,
          message: "Unable to submit your verification right now. Please try again.",
          reference: correlationId,
          correlationId,
        };
  }
}

/**
 * A validation refusal, recorded as well as returned.
 *
 * These used to return silently, so "the KYC page shows an error" was
 * unanswerable from the system log — there was no row saying which field the
 * person tripped on. Recorded as `ok`, not `failed`: a form catching a missing
 * field is the form working.
 */
function reject(message: string, correlationId: string): KycActionResult {
  recordPipelineEvent({
    pipeline: "kyc",
    operation: "kyc.submit.invalid",
    status: "ok",
    message: `Submission rejected before any write: ${message}`,
  });
  return { ok: false, message, correlationId };
}

/** Moves an untouched account to `in_progress` when the flow is opened. */
export async function startKycAction(): Promise<KycActionResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };

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

/**
 * One presigned S3 upload slot, for one file the person has just chosen.
 *
 * The account comes from the session and the key is generated server-side
 * (`kyc/{userId}/{kind}/{uuid}`), so the browser cannot aim an upload at
 * another account's prefix. The type and exact size are signed into the URL;
 * S3 refuses a body that differs. Nothing is recorded by this call — a slot
 * that is never used leaves at most an orphan object the submission never
 * claims.
 */
export interface KycUploadTargetResult {
  ok: boolean;
  message?: string;
  key?: string;
  url?: string;
  headers?: Record<string, string>;
}

export async function createKycUploadTargetAction(input: {
  kind: "document" | "selfie";
  contentType: string;
  byteSize: number;
}): Promise<KycUploadTargetResult> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (input.kind !== "document" && input.kind !== "selfie") {
    return { ok: false, message: "Unknown upload." };
  }
  if (kycUploadModeFor(account) !== "s3") {
    return { ok: false, message: "Document upload is not available right now." };
  }
  // The same rule the submission applies, before a slot is signed: a selfie
  // slot is never issued for a PDF.
  const refusal = kycFileRefusal(input.kind, {
    contentType: String(input.contentType),
    byteSize: Number(input.byteSize),
  });
  if (refusal) return { ok: false, message: refusal };

  try {
    const target = await issueKycUploadTarget(account, {
      kind: input.kind,
      contentType: String(input.contentType),
      byteSize: Number(input.byteSize),
    });
    return { ok: true, key: target.key, url: target.url, headers: target.headers };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof KycStorageError
          ? error.message
          : "Could not prepare the upload. Try again.",
    };
  }
}

/**
 * The browser's report that a direct upload to storage failed.
 *
 * The PUT goes from the browser straight to S3, so a failure there — most
 * often the bucket's CORS rule not allowing this site's origin, which looks
 * to the browser like a dropped connection — never reaches this server and
 * would leave no trace. This records it (stage and HTTP status only: no key,
 * no URL, no file) and returns the correlation id as the reference the
 * person can quote.
 */
export async function reportKycUploadProblemAction(input: {
  kind: "document" | "selfie";
  stage: "prepare" | "put" | "timeout";
  httpStatus?: number;
}): Promise<{ reference: string }> {
  return traceAction(
    { name: "kyc.upload_problem", actorType: "user", pipeline: "kyc" },
    () => recordUploadProblem(input),
  );
}

async function recordUploadProblem(input: {
  kind: "document" | "selfie";
  stage: "prepare" | "put" | "timeout";
  httpStatus?: number;
}): Promise<{ reference: string }> {
  const correlationId = currentCorrelationId();
  const account = await getUsableAccount().catch(() => null);
  const kind = input?.kind === "selfie" ? "selfie" : "document";
  const stage = ["prepare", "put", "timeout"].includes(input?.stage) ? input.stage : "put";
  const httpStatus = Number.isInteger(input?.httpStatus) ? Number(input.httpStatus) : 0;
  recordPipelineEvent({
    pipeline: "kyc",
    operation: "kyc.upload.failed",
    status: "failed",
    message:
      stage === "put" && httpStatus === 0
        ? "Browser could not reach S3 for the upload (check the bucket CORS rule for this origin)"
        : `KYC ${kind} upload failed at ${stage}${httpStatus ? ` (HTTP ${httpStatus})` : ""}`,
    userId: account?.userId,
    metadata: { kind, stage, httpStatus },
  });
  return { reference: correlationId };
}
