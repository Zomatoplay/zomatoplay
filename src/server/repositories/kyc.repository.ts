import "server-only";

import { asc, desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { KycSubmission } from "@/types/admin";

import { toKycSubmission } from "./mappers";

/**
 * Verification cases.
 *
 * Documents and notes are fetched as two flat queries and grouped in memory
 * rather than as a join per case: the review queue loads every open case at
 * once, and a join would multiply each submission by its documents.
 */
export async function listKycSubmissions(
  db: Database,
): Promise<KycSubmission[]> {
  const submissions = await db
    .select({ submission: schema.kycSubmissions, user: schema.users })
    .from(schema.kycSubmissions)
    .innerJoin(schema.users, eq(schema.users.id, schema.kycSubmissions.userId))
    .orderBy(desc(schema.kycSubmissions.submittedAt));

  if (submissions.length === 0) return [];

  const [documents, notes] = await Promise.all([
    db
      .select()
      .from(schema.kycDocuments)
      .orderBy(asc(schema.kycDocuments.uploadedAt)),
    db.select().from(schema.kycNotes).orderBy(asc(schema.kycNotes.createdAt)),
  ]);

  const documentsBySubmission = new Map<string, typeof documents>();
  for (const document of documents) {
    const bucket = documentsBySubmission.get(document.submissionId) ?? [];
    bucket.push(document);
    documentsBySubmission.set(document.submissionId, bucket);
  }

  const notesBySubmission = new Map<string, typeof notes>();
  for (const note of notes) {
    const bucket = notesBySubmission.get(note.submissionId) ?? [];
    bucket.push(note);
    notesBySubmission.set(note.submissionId, bucket);
  }

  return submissions.map(({ submission, user }) =>
    toKycSubmission(
      submission,
      { userName: user.fullName, userDisplayId: user.displayId },
      documentsBySubmission.get(submission.id) ?? [],
      notesBySubmission.get(submission.id) ?? [],
    ),
  );
}

/**
 * The signed-in account's own latest verification case.
 *
 * **Scoped by `userId`, always.** This is the only KYC read the user
 * application makes, and it takes the account id from the session — there is no
 * submission-id parameter anywhere on the user side, so there is nothing a
 * caller could substitute to read somebody else's case.
 *
 * The projection is deliberately narrow: a status, the reviewer's reason, and
 * two timestamps. No document rows, no internal notes, no risk flags, no
 * masked document number — none of which the person needs and all of which
 * belong to the review, not to them.
 */
export async function findOwnKycCase(
  db: Database,
  userId: string,
): Promise<OwnKycCase | null> {
  const [row] = await db
    .select({
      status: schema.kycSubmissions.status,
      rejectionReason: schema.kycSubmissions.rejectionReason,
      submittedAt: schema.kycSubmissions.submittedAt,
      reviewedAt: schema.kycSubmissions.reviewedAt,
    })
    .from(schema.kycSubmissions)
    .where(eq(schema.kycSubmissions.userId, userId))
    // Newest first: a resubmission supersedes the case before it, and the one
    // the person is being told about is the most recent.
    .orderBy(desc(schema.kycSubmissions.submittedAt))
    .limit(1);

  if (!row) return null;

  return {
    status: row.status,
    rejectionReason: row.rejectionReason,
    submittedAt: row.submittedAt.toISOString(),
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
  };
}

/** What a person may know about their own verification. */
export interface OwnKycCase {
  status: (typeof schema.kycReviewStatusEnum.enumValues)[number];
  /** The reviewer's stated reason, when they were rejected or asked to resubmit. */
  rejectionReason: string | null;
  submittedAt: string;
  reviewedAt: string | null;
}
