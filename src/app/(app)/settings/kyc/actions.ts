"use server";

import { revalidate } from "@/server/revalidate";

import { getAuthenticatedAccount } from "@/server/auth/account";
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
import { areKycDocumentsRequired } from "@/server/services/kyc-policy";
import {
  startKyc,
  submitKyc,
  type KycUploadedDocument,
} from "@/server/services/kyc-write.service";
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
  documentType: "passport" | "national_id" | "driving_licence" | "aadhaar" | "pan";
  /** The last four characters of the document number. Never the whole thing. */
  documentNumberLast4: string;

  /*
   * THE FILE FIELDS ARE OPTIONAL, AND THAT IS A POLICY, NOT A LOOSENING.
   *
   * Document upload is not enabled on this deployment. The flow used to
   * require all five of these fields unconditionally, so a person who filled
   * the form correctly and had nothing to attach was refused at the last step
   * with "Attach a photo of your document" — a requirement for something the
   * product was not yet asking for.
   *
   * Optional here means *may be absent*. It does not mean trusted when
   * present: a supplied path is still checked against this session's own
   * `auth.uid()` folder and re-read from Storage before any row claims it
   * exists, and a supplied file that fails either check still refuses the
   * whole submission. `KYC_REQUIRE_DOCUMENTS=true` makes them mandatory again
   * in one place — see `@/server/services/kyc-policy`.
   */
  documentFileName?: string;
  documentByteSize?: number;
  documentMimeType?: string;
  /** Object key in the private `kyc-documents` bucket, written by the browser. */
  documentPath?: string;
  selfieFileName?: string;
  selfiePath?: string;
}

/** The document types the schema's enum accepts. Anything else is refused. */
const DOCUMENT_TYPES = new Set(["passport", "national_id", "driving_licence", "aadhaar", "pan"]);

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

  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in.", correlationId };

  /* ---------------------------------------------------------------- */
  /* Identity fields — required at every policy setting                */
  /* ---------------------------------------------------------------- */
  const legalName = input.legalName.trim();
  if (legalName.length < 2) {
    return reject("Enter your full legal name.", correlationId);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateOfBirth)) {
    return reject("Enter your date of birth.", correlationId);
  }
  if (!DOCUMENT_TYPES.has(input.documentType)) {
    return reject("Choose a document type.", correlationId);
  }

  const last4 = input.documentNumberLast4.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (last4.length !== 4) {
    return reject("Enter your document number.", correlationId);
  }

  /* ---------------------------------------------------------------- */
  /* Files — required only when the policy says so                     */
  /* ---------------------------------------------------------------- */
  const documentsRequired = areKycDocumentsRequired();
  const hasDocument = Boolean(input.documentPath && input.documentFileName);
  const hasSelfie = Boolean(input.selfiePath && input.selfieFileName);

  if (documentsRequired && !hasDocument) {
    return reject("Attach a photo of your document.", correlationId);
  }
  if (documentsRequired && !hasSelfie) {
    return reject("Take a selfie before submitting.", correlationId);
  }

  /*
   * A CLIENT-SIDE SIZE IS A COURTESY; THE SERVER CHECKS IT ANYWAY.
   *
   * Only meaningful when a file is actually being claimed. The authoritative
   * numbers come back from Storage below, but refusing an obviously impossible
   * claim here saves a round trip and keeps the message specific.
   */
  if (hasDocument && input.documentByteSize !== undefined) {
    if (!Number.isFinite(input.documentByteSize) || input.documentByteSize <= 0) {
      return reject("That document could not be read. Try attaching it again.", correlationId);
    }
    if (input.documentByteSize > MAX_DOCUMENT_BYTES) {
      return reject("That document is larger than 10 MB.", correlationId);
    }
  }

  /*
   * EVERY UPLOAD THAT IS CLAIMED IS VERIFIED BEFORE ANYTHING IS WRITTEN.
   *
   * Each object must exist, belong to *this* account's folder, and be a type
   * and size the bucket accepts. The client's byte size and MIME type are UX
   * values from the file picker; these are the numbers Storage recorded, and
   * they are what the row keeps.
   *
   * A failure here refuses the whole submission, exactly as before. The
   * difference is only that a submission claiming *no* file has nothing to
   * verify — it does not fail, because there is no unmet claim.
   */
  let document: KycUploadedDocument | undefined;
  let selfie: KycUploadedDocument | undefined;
  try {
    const [documentObject, selfieObject] = await Promise.all([
      hasDocument
        ? verifyOwnKycUpload(account, input.documentPath as string)
        : Promise.resolve(null),
      hasSelfie
        ? verifyOwnKycUpload(account, input.selfiePath as string)
        : Promise.resolve(null),
    ]);

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
    return {
      ok: false,
      correlationId,
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
          documentsRequired,
          hasDocument: Boolean(document),
          hasSelfie: Boolean(selfie),
        },
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
      message: document
        ? "Submitted for review."
        : "Submitted for review. We will ask for your documents if we need them.",
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
    return { ok: false, message: failure.message, correlationId };
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
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };
  if (input.kind !== "document" && input.kind !== "selfie") {
    return { ok: false, message: "Unknown upload." };
  }
  if (kycUploadModeFor(account) !== "s3") {
    return { ok: false, message: "Document upload is not available right now." };
  }

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
