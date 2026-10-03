import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import * as t from "@/db/schema";

import { mutate, newId, withReason, type Actor } from "../write";
import { kycFileRefusal } from "./kyc-policy";

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
 * One uploaded file, as storage described it after the upload — never a
 * placeholder. See `@/server/services/kyc-policy`.
 */
export interface KycUploadedDocument {
  fileName: string;
  /** Object key in the private bucket, already verified against the session. */
  path: string;
  /** As Storage recorded it, not as the browser claimed. */
  byteSize: number;
  mimeType: string;
  /** Which store `path` is a key in. */
  storageBackend: "s3" | "supabase";
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
  /** The uploaded identity document, or null — uploads are optional. */
  document: KycUploadedDocument | null;
  /** The live photo, or null — optional too. */
  selfie: KycUploadedDocument | null;
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
  /*
   * Each file is optional, but whatever IS attached is checked again here
   * rather than trusted from the action: this is the layer that writes the
   * case, whoever calls it.
   */
  if (request.document && request.selfie && request.document.path === request.selfie.path) {
    throw new KycError("The live photo must be a separate photo from the document.");
  }
  const fileRefusal =
    (request.document
      ? kycFileRefusal("document", {
          contentType: request.document.mimeType,
          byteSize: request.document.byteSize,
        })
      : null) ??
    (request.selfie
      ? kycFileRefusal("selfie", {
          contentType: request.selfie.mimeType,
          byteSize: request.selfie.byteSize,
        })
      : null);
  if (fileRefusal) throw new KycError(fileRefusal);

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
        storageBackend: request.document.storageBackend,
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
        storageBackend: request.selfie.storageBackend,
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
      // True statements about what this deployment did and what was provided,
      // not about the person — so a reviewer never mistakes a case without
      // files for a checked one.
      riskFlags: [
        LIVENESS_NOT_VERIFIED,
        ...(request.document ? [] : ["no_document_uploaded"]),
        ...(request.selfie ? [] : ["no_live_photo"]),
      ],
    });

    /*
     * Only the files actually provided: each `storagePath` points at an object
     * in the private bucket that `verifyOwnKycUpload` has already confirmed
     * exists, belongs to this account and is the right kind of file.
     */
    if (documents.length > 0) await tx.insert(t.kycDocuments).values(documents);

    await tx
      .update(t.users)
      .set({ kycStatus: "pending_review", updatedAt: now })
      .where(eq(t.users.id, request.userId));

    audit({
      action: "kyc_note_added",
      target: { type: "kyc", id: submissionId, label: request.userId },
      details:
        documents.length === 0
          ? "User submitted identity verification with declared details and a " +
            "verified mobile number only — no document or live photo was " +
            "uploaded (both are optional). Nothing has been verified yet; " +
            "approval is the reviewer's decision."
          : `User submitted identity verification with ${request.document ? "an identity document" : "no identity document"} ` +
            `and ${request.selfie ? "a live photo" : "no live photo"}. Awaiting review. No ` +
            "automated liveness check ran — none is connected — so any photo " +
            "must be compared by hand.",
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
