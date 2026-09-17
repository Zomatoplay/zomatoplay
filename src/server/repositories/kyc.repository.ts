import "server-only";

import { and, asc, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type {
  AdminListQuery,
  KycSubmission,
  PagedResult,
} from "@/types/admin";

import { likePattern, pageTotal, readPage } from "./paginate";
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
  options: { limit?: number } = {},
): Promise<KycSubmission[]> {
  const base = db
    .select({ submission: schema.kycSubmissions, user: schema.users })
    .from(schema.kycSubmissions)
    .innerJoin(schema.users, eq(schema.users.id, schema.kycSubmissions.userId))
    .orderBy(desc(schema.kycSubmissions.submittedAt));
  const submissions = options.limit ? await base.limit(options.limit) : await base;

  // Documents and notes are attached by the shared helper below, scoped to the
  // ids actually returned — these two reads once had no `WHERE` at all and
  // fetched every KYC document and note on the platform to serve one page.
  return attachKycDetail(db, submissions);
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

/* -------------------------------------------------------------------------- */
/* The paginated review queue                                                  */
/* -------------------------------------------------------------------------- */

function kycSearchCondition(search: string) {
  if (!search) return undefined;
  const pattern = likePattern(search);
  return or(
    ilike(schema.kycSubmissions.id, pattern),
    ilike(schema.kycSubmissions.legalName, pattern),
    ilike(schema.users.fullName, pattern),
    ilike(schema.users.email, pattern),
    ilike(schema.users.displayId, pattern),
  );
}

/**
 * One page of the verification queue.
 *
 * The documents and notes are attached by `attachKycDetail`, the same helper
 * `listKycSubmissions` uses — and it is scoped to the ids actually returned,
 * so a ten-row page reads ten cases' documents rather than the platform's.
 */
export async function pageKycSubmissions(
  db: Database,
  query: AdminListQuery,
): Promise<PagedResult<KycSubmission>> {
  const where = and(
    query.status === "all"
      ? undefined
      : eq(
          schema.kycSubmissions.status,
          query.status as (typeof schema.kycSubmissions.status.enumValues)[number],
        ),
    kycSearchCondition(query.search),
  );

  return readPage(query, async (page) => {
    const rows = await db
      .select({
        submission: schema.kycSubmissions,
        user: schema.users,
        total: pageTotal,
      })
      .from(schema.kycSubmissions)
      .innerJoin(schema.users, eq(schema.users.id, schema.kycSubmissions.userId))
      .where(where)
      .orderBy(
        query.sort === "oldest"
          ? asc(schema.kycSubmissions.submittedAt)
          : desc(schema.kycSubmissions.submittedAt),
      )
      .limit(query.pageSize)
      .offset((page - 1) * query.pageSize);

    return {
      rows: await attachKycDetail(db, rows),
      total: Number(rows[0]?.total ?? 0),
    };
  });
}

export async function countKycSubmissionsByStatus(
  db: Database,
  query: AdminListQuery,
): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: schema.kycSubmissions.status,
      count: sql<number>`count(*)::int`,
    })
    .from(schema.kycSubmissions)
    .innerJoin(schema.users, eq(schema.users.id, schema.kycSubmissions.userId))
    .where(kycSearchCondition(query.search))
    .groupBy(schema.kycSubmissions.status);

  const counts: Record<string, number> = { all: 0 };
  for (const row of rows) {
    counts[row.status] = Number(row.count);
    counts.all += Number(row.count);
  }
  return counts;
}

/** Attaches each case's documents and notes, scoped to the ids given. */
async function attachKycDetail(
  db: Database,
  submissions: {
    submission: typeof schema.kycSubmissions.$inferSelect;
    user: typeof schema.users.$inferSelect;
  }[],
): Promise<KycSubmission[]> {
  if (submissions.length === 0) return [];
  const submissionIds = submissions.map(({ submission }) => submission.id);

  const [documents, notes] = await Promise.all([
    db
      .select()
      .from(schema.kycDocuments)
      .where(inArray(schema.kycDocuments.submissionId, submissionIds))
      .orderBy(asc(schema.kycDocuments.uploadedAt)),
    db
      .select()
      .from(schema.kycNotes)
      .where(inArray(schema.kycNotes.submissionId, submissionIds))
      .orderBy(asc(schema.kycNotes.createdAt)),
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
