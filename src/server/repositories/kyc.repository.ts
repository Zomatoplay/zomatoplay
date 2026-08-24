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
