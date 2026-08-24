import "server-only";

import { and, eq, inArray } from "drizzle-orm";

import * as t from "@/db/schema";

import { mutate, newId, withReason, type Actor } from "../write";

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
export async function submitKyc(
  request: {
    userId: string;
    legalName: string;
    dateOfBirth: string;
    nationality?: string;
    address?: string;
    documentType: (typeof t.kycDocumentTypeEnum.enumValues)[number];
    documentNumberMasked: string;
    documentFileName: string;
    livenessCheckPassed: boolean;
  },
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
      livenessCheckPassed: request.livenessCheckPassed,
      riskFlags: [],
    });

    // Metadata only. No file is uploaded anywhere; there is nowhere to put it.
    await tx.insert(t.kycDocuments).values({
      id: newId("kyd", now),
      submissionId,
      label: "Identity document",
      type: request.documentType,
      fileName: request.documentFileName.slice(0, 120),
      uploadedAt: now,
      pages: 1,
    });

    await tx
      .update(t.users)
      .set({ kycStatus: "pending_review", updatedAt: now })
      .where(eq(t.users.id, request.userId));

    audit({
      action: "kyc_note_added",
      target: { type: "kyc", id: submissionId, label: request.userId },
      details: "User submitted identity verification. Awaiting review.",
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
