import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { ts } from "./columns";
import { kycDocumentTypeEnum, kycReviewStatusEnum } from "./enums";
import { users } from "./users";

/**
 * A verification case, as the CRM reviews it.
 *
 * The declared details are stored masked (`documentNumberMasked`) and the
 * documents are file *references* only — see `kycDocuments`. Both are
 * deliberate: there is no document store and no provider, and a prototype
 * should not start accumulating identity data it cannot protect.
 *
 * INTEGRATION POINT: a KYC provider owns this record. `status`, `riskFlags` and
 * the documents come from their API and webhooks; `reviewedBy` comes from the
 * operator session.
 */
export const kycSubmissions = pgTable(
  "kyc_submissions",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    submittedAt: ts("submitted_at").notNull(),
    status: kycReviewStatusEnum("status").notNull().default("pending"),
    legalName: text("legal_name").notNull(),
    dateOfBirth: text("date_of_birth").notNull(),
    nationality: text("nationality").notNull(),
    address: text("address").notNull(),
    documentType: kycDocumentTypeEnum("document_type").notNull(),
    documentNumberMasked: text("document_number_masked").notNull(),
    livenessCheckPassed: boolean("liveness_check_passed").notNull().default(false),
    reviewedBy: text("reviewed_by"),
    reviewedAt: ts("reviewed_at"),
    rejectionReason: text("rejection_reason"),
    /** Automated signals a provider would return. */
    riskFlags: jsonb("risk_flags").$type<string[]>().notNull().default([]),
  },
  (table) => [
    index("kyc_submissions_user_idx").on(table.userId),
    index("kyc_submissions_status_idx").on(table.status),
    index("kyc_submissions_submitted_idx").on(table.submittedAt),
  ],
);

/**
 * Uploaded identity documents.
 *
 * `storagePath` is the object's key in the private `kyc-documents` Supabase
 * Storage bucket, shaped `{auth_user_id}/{submission_id}/{file}`. The bytes are
 * **not** in Postgres and must not be: a document is megabytes of binary that
 * nothing here queries, and a `bytea` column would put it in every backup,
 * every replica and every `select *` a future reader writes by accident.
 *
 * The leading folder is the owner's `auth.uid()`, which is what the storage
 * policies key on — a person may read only their own folder, and a KYC operator
 * may read the bucket. See `db/scripts/secure.ts`.
 *
 * All three columns are nullable because rows written before storage existed
 * carry only a filename, and a migration cannot invent an object for them.
 * `storagePath === null` means exactly "there is no file to open", and the CRM
 * says so rather than offering a link that 404s.
 */
export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => kycSubmissions.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    type: kycDocumentTypeEnum("type").notNull(),
    fileName: text("file_name").notNull(),
    /** Object key in the private bucket. Null for pre-storage rows. */
    storagePath: text("storage_path"),
    /**
     * Which store `storage_path` is a key in: `supabase` (the original private
     * bucket, every row written before S3) or `s3` (`@/server/storage`).
     * Defaulted for the existing rows, so a reviewer can still open a document
     * uploaded before the move — the key alone cannot say where it lives.
     */
    storageBackend: text("storage_backend").notNull().default("supabase"),
    /** As Storage recorded it, not as the browser claimed. */
    contentType: text("content_type"),
    byteSize: integer("byte_size"),
    uploadedAt: ts("uploaded_at").notNull(),
    pages: integer("pages").notNull().default(1),
  },
  (table) => [
    index("kyc_documents_submission_idx").on(table.submissionId),
    // A given object belongs to one document row. Without this a replayed
    // submission could point two rows at the same key.
    uniqueIndex("kyc_documents_storage_path_key").on(table.storagePath),
  ],
);

/** Reviewer notes on a case. Append-only in the UI. */
export const kycNotes = pgTable(
  "kyc_notes",
  {
    id: text("id").primaryKey(),
    submissionId: text("submission_id")
      .notNull()
      .references(() => kycSubmissions.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    createdAt: ts("created_at").notNull(),
  },
  (table) => [index("kyc_notes_submission_idx").on(table.submissionId)],
);
