import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import * as t from "@/db/schema";

import { mutate, newId, withReason, type Actor } from "../write";
import { DOCUMENTS_NOT_PROVIDED } from "./kyc-policy";

/**
 * Verification decisions.
 *
 * Extracted from the server actions that used to hold this SQL inline, for two
 * reasons. It restores the layering the rest of the codebase follows — action
 * authenticates and authorizes, service does the work — and it makes the
 * lifecycle testable without a request: an action now resolves its operator
 * from a Supabase session, so a test calling one directly is testing the gate
 * rather than the decision.
 *
 * Every function takes an `Actor` it does not choose. Deciding *who* may call
 * these is the action's job and happens before any of them runs.
 */

export class KycError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KycError";
  }
}

/**
 * Records a user's submission.
 *
 * The only transition a user may cause: `not_started` / `in_progress` /
 * `rejected` → `pending_review`. `verified` is not reachable from here at any
 * input, which is the whole point — it used to be a button in the browser.
 */
/**
 * One uploaded file, as Storage described it.
 *
 * Present only when a file was genuinely uploaded and verified. There is no
 * "empty" variant and no placeholder: an absent document is `undefined`, and
 * `submitKyc` writes no row for it. See `@/server/services/kyc-policy`.
 */
export interface KycUploadedDocument {
  fileName: string;
  /** Object key in the private bucket, already verified against the session. */
  path: string;
  /** As Storage recorded it, not as the browser claimed. */
  byteSize: number;
  mimeType: string;
}

export interface KycSubmissionRequest {
  userId: string;
  legalName: string;
  dateOfBirth: string;
  nationality?: string;
  address?: string;
  documentType: (typeof t.kycDocumentTypeEnum.enumValues)[number];
  /** Already masked by the caller — the full number never reaches this layer. */
  documentNumberMasked: string;
  /**
   * The identity document, when one was uploaded.
   *
   * Optional because document upload is not enabled on this deployment
   * (`KYC_REQUIRE_DOCUMENTS`). Optional means absent, never fabricated: when
   * it is undefined no `kyc_documents` row is written at all, rather than a
   * row with an invented filename or a storage path pointing at nothing.
   */
  document?: KycUploadedDocument;
  /** The selfie the reviewer compares against the document, when one exists. */
  selfie?: KycUploadedDocument;
}

/**
 * The risk flag a real provider's absence produces.
 *
 * `riskFlags` is described in the schema as "automated signals a provider would
 * return", and the CRM already renders them and refuses to recommend approval
 * while any is present. "No automated check ran" is exactly such a signal, and
 * putting it here means the case panel tells the reviewer why the liveness row
 * reads *Not passed* — rather than leaving them to guess whether the person
 * failed a check or no check exists.
 */
const LIVENESS_NOT_VERIFIED = "liveness_not_verified";

export async function submitKyc(
  request: KycSubmissionRequest,
  actor: Actor,
): Promise<{ submissionId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const [user] = await tx
      .select({ id: t.users.id, kycStatus: t.users.kycStatus })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1)
      .for("update");

    if (!user) throw new KycError("Account not found.");
    if (user.kycStatus === "verified") {
      throw new KycError("This account is already verified.");
    }
    if (user.kycStatus === "pending_review") {
      throw new KycError("A submission is already under review.");
    }

    // Supersede any earlier open case so the queue holds one per account.
    await tx
      .update(t.kycSubmissions)
      .set({ status: "resubmission_requested" })
      .where(
        and(
          eq(t.kycSubmissions.userId, request.userId),
          inArray(t.kycSubmissions.status, ["pending", "under_review"]),
        ),
      );

    const submissionId = newId("kyc", now);

    const documents: (typeof t.kycDocuments.$inferInsert)[] = [];
    if (request.document) {
      documents.push({
        id: newId("kyd", now),
        submissionId,
        label: "Identity document",
        type: request.documentType,
        fileName: request.document.fileName.slice(0, 120),
        storagePath: request.document.path,
        contentType: request.document.mimeType,
        byteSize: request.document.byteSize,
        uploadedAt: now,
        pages: 1,
      });
    }
    if (request.selfie) {
      documents.push({
        // Offset by a millisecond so two ids generated in the same call cannot
        // collide — `newId` derives from the timestamp.
        id: newId("kyd", new Date(now.getTime() + 1)),
        submissionId,
        label: "Selfie capture",
        type: request.documentType,
        fileName: request.selfie.fileName.slice(0, 120),
        storagePath: request.selfie.path,
        contentType: request.selfie.mimeType,
        byteSize: request.selfie.byteSize,
        uploadedAt: now,
        pages: 1,
      });
    }

    await tx.insert(t.kycSubmissions).values({
      id: submissionId,
      userId: request.userId,
      submittedAt: now,
      status: "pending",
      legalName: request.legalName,
      dateOfBirth: request.dateOfBirth,
      nationality: request.nationality?.trim() || "India",
      address: request.address?.trim() || "",
      documentType: request.documentType,
      // Only the masked form is stored — there is no document store and no
      // provider, and a prototype should not accumulate identity numbers.
      documentNumberMasked: request.documentNumberMasked.trim().slice(-32),
      /*
       * Always false, and not a parameter.
       *
       * This column means "an automated liveness check ran and passed". No
       * provider is connected, so nothing can have. It used to be whatever the
       * browser sent, which was `true` whenever a button had been pressed —
       * a claim about somebody's identity, written into the table an operator
       * approves from, that nothing had established.
       */
      livenessCheckPassed: false,
      /*
       * Both signals a reviewer needs, and both of them true statements about
       * what this deployment did rather than about the person.
       *
       * `documents_not_provided` is added when the submission carries no
       * files. The CRM renders risk flags and declines to recommend approval
       * while any is present, so a case with nothing to inspect arrives marked
       * as such instead of looking like a complete one whose documents failed
       * to render.
       */
      riskFlags: documents.length === 0
        ? [LIVENESS_NOT_VERIFIED, DOCUMENTS_NOT_PROVIDED]
        : [LIVENESS_NOT_VERIFIED],
    });

    /*
     * One row per file that actually exists, and none for one that does not.
     *
     * A reviewer compares two things where both are present — the document and
     * the face — which is why the seeded cases carry a separate "Liveness
     * capture" row and the CRM lists documents rather than assuming one.
     *
     * When a file is absent the row is simply not written. The alternative —
     * a row with a placeholder filename and a null `storage_path` — would put
     * "there is a document here" into the table an operator approves from,
     * about a document that does not exist. That is the same class of mistake
     * as a client-supplied `liveness_check_passed` (CLAUDE.md §23), and it is
     * not worth making for a filename.
     *
     * `storagePath` points at an object in the private bucket that
     * `describeOwnUpload` has already confirmed exists and belongs to this
     * account. The bytes are not here; see the note on the table.
     */
    if (documents.length > 0) {
      await tx.insert(t.kycDocuments).values(documents);
    }

    await tx
      .update(t.users)
      .set({ kycStatus: "pending_review", updatedAt: now })
      .where(eq(t.users.id, request.userId));

    audit({
      action: "kyc_note_added",
      target: { type: "kyc", id: submissionId, label: request.userId },
      details:
        documents.length === 0
          ? "User submitted identity verification with declared details only. " +
            "Document upload is not enabled on this deployment, so no files " +
            "were provided and none were expected. No automated liveness " +
            "check ran — none is connected."
          : `User submitted identity verification with ${documents.length} ` +
            `document${documents.length === 1 ? "" : "s"}. Awaiting review. No ` +
            "automated liveness check ran — none is connected — so the selfie " +
            "must be compared with the document by hand.",
    });

    return { submissionId };
  });
}

/** `not_started` → `in_progress`, when the flow is first opened. */
export async function startKyc(
  request: { userId: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now }) => {
    await tx
      .update(t.users)
      .set({ kycStatus: "in_progress", updatedAt: now })
      .where(
        and(eq(t.users.id, request.userId), eq(t.users.kycStatus, "not_started")),
      );
  });
}

export async function approveKyc(
  request: { submissionId: string; note?: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const submission = await lock(tx, request.submissionId);
    if (submission.status === "approved") {
      throw new KycError("That submission is already approved.");
    }

    await tx
      .update(t.kycSubmissions)
      .set({
        status: "approved",
        reviewedBy: actor.name,
        reviewedAt: now,
        rejectionReason: null,
      })
      // Re-asserted, so two operators deciding at once cannot both win.
      .where(
        and(
          eq(t.kycSubmissions.id, submission.id),
          eq(t.kycSubmissions.status, submission.status),
        ),
      );

    await tx
      .update(t.users)
      .set({ kycStatus: "verified", updatedAt: now })
      .where(eq(t.users.id, submission.userId));

    audit({
      action: "kyc_approved",
      target: { type: "kyc", id: submission.id, label: submission.legalName },
      details: withReason(
        `Approved verification for ${submission.legalName}.`,
        request.note,
      ),
    });
  });
}

export async function rejectKyc(
  request: { submissionId: string; reason: string },
  actor: Actor,
): Promise<void> {
  const reason = request.reason?.trim();
  // The reason is what the user is shown, so it is the message rather than
  // paperwork — a rejection without one tells them nothing to act on.
  if (!reason) throw new KycError("A reason is required — the user is shown it.");

  return mutate(actor, async ({ tx, now, audit }) => {
    const submission = await lock(tx, request.submissionId);

    await tx
      .update(t.kycSubmissions)
      .set({
        status: "rejected",
        reviewedBy: actor.name,
        reviewedAt: now,
        rejectionReason: reason,
      })
      .where(eq(t.kycSubmissions.id, submission.id));

    await tx
      .update(t.users)
      .set({ kycStatus: "rejected", updatedAt: now })
      .where(eq(t.users.id, submission.userId));

    audit({
      action: "kyc_rejected",
      target: { type: "kyc", id: submission.id, label: submission.legalName },
      details: withReason(
        `Rejected verification for ${submission.legalName}.`,
        reason,
      ),
    });
  });
}

export async function requestKycResubmission(
  request: { submissionId: string; reason: string },
  actor: Actor,
): Promise<void> {
  const reason = request.reason?.trim();
  if (!reason) throw new KycError("A reason is required.");

  return mutate(actor, async ({ tx, now, audit }) => {
    const submission = await lock(tx, request.submissionId);

    await tx
      .update(t.kycSubmissions)
      .set({
        status: "resubmission_requested",
        reviewedBy: actor.name,
        reviewedAt: now,
        rejectionReason: reason,
      })
      .where(eq(t.kycSubmissions.id, submission.id));

    // Back to in_progress: the account can submit again, which `rejected` also
    // allows but reads to the user as a final answer.
    await tx
      .update(t.users)
      .set({ kycStatus: "in_progress", updatedAt: now })
      .where(eq(t.users.id, submission.userId));

    audit({
      action: "kyc_resubmission_requested",
      target: { type: "kyc", id: submission.id, label: submission.legalName },
      details: withReason("Requested resubmission.", reason),
    });
  });
}

export async function addKycNote(
  request: { submissionId: string; body: string },
  actor: Actor,
): Promise<void> {
  const body = request.body?.trim();
  if (!body) throw new KycError("The note is empty.");

  return mutate(actor, async ({ tx, now, audit }) => {
    await tx.insert(t.kycNotes).values({
      id: newId("kyn", now),
      submissionId: request.submissionId,
      author: actor.name,
      body,
      createdAt: now,
    });

    audit({
      action: "kyc_note_added",
      target: {
        type: "kyc",
        id: request.submissionId,
        label: request.submissionId,
      },
      details: "Added an internal note.",
    });
  });
}

async function lock(
  tx: Parameters<Parameters<typeof mutate>[1]>[0]["tx"],
  submissionId: string,
) {
  const [submission] = await tx
    .select()
    .from(t.kycSubmissions)
    .where(eq(t.kycSubmissions.id, submissionId))
    .limit(1)
    .for("update");
  if (!submission) throw new KycError("That submission no longer exists.");
  return submission;
}
