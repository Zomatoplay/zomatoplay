import "server-only";

import { createSupabaseServerClient } from "@/server/auth/session";

/**
 * The private KYC document bucket, from the server's side.
 *
 * WHERE THE BYTES GO, AND WHY NOT THROUGH HERE
 * --------------------------------------------
 * The browser uploads straight to Supabase Storage. This module never handles a
 * file. That is not a shortcut: a Vercel serverless function has a ~4.5 MB
 * request body limit and an identity document routinely exceeds it, so a
 * 10 MB passport scan routed through a server action would work in development
 * and fail in production — the worst place to discover a limit.
 *
 * The upload is still validated server-side, and more strictly than this
 * application could manage on its own. `file_size_limit` and
 * `allowed_mime_types` on the bucket are enforced **by the storage service**
 * before an object exists, and the INSERT policy pins every object under a
 * folder named for the uploader's own `auth.uid()`. A client that lies about a
 * file's type, its size, or whose folder it belongs in is refused by Postgres
 * and by Storage, not by code that believed it. See `db/scripts/secure.ts`.
 *
 * WHAT THIS MODULE IS FOR
 * -----------------------
 * Two things the browser must not be trusted to do:
 *
 *  1. **Confirm an object really exists and what it actually is** before a
 *     database row claims it does (`describeOwnUpload`).
 *  2. **Mint a short-lived signed URL** so a document can be opened without the
 *     bucket ever being public (`signKycDocument`).
 *
 * Both run as the *caller's* Supabase session, so the storage policies decide
 * what is visible. There is no service-role key here and there must not be:
 * CLAUDE.md §19.6 refuses it, and a module that held one would be able to read
 * every document regardless of who asked.
 */

export const KYC_BUCKET = "kyc-documents";

/** Kept in step with the bucket's own `file_size_limit`. */
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;

/** Kept in step with the bucket's own `allowed_mime_types`. */
export const ACCEPTED_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export class KycStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KycStorageError";
  }
}

export interface StoredDocument {
  path: string;
  /** As Storage recorded it, not as the browser said. */
  contentType: string;
  byteSize: number;
}

/**
 * The shape an object key must have: `{auth_user_id}/{rest}`.
 *
 * The first segment is what every storage policy keys on, so it is the only
 * part this application ever reasons about.
 */
const PATH_PATTERN = /^([0-9a-f-]{36})\/[A-Za-z0-9._/-]{1,180}$/;

/**
 * Confirms an uploaded object belongs to this caller, and reports what it
 * actually is.
 *
 * THE PATH IS CHECKED AGAINST THE SESSION, NOT ACCEPTED
 * ----------------------------------------------------
 * A client sends a path. Two independent things stop it naming somebody else's
 * document, and the second one is the reason this function exists rather than
 * just trusting the first:
 *
 *  - the storage SELECT policy would refuse to show it, so `list` returns
 *    nothing and this throws; and
 *  - the leading folder is compared to `authUserId` here, before anything is
 *    read, so a path that is not this person's is rejected outright rather than
 *    relying on the policy to be the only line of defence.
 *
 * The size and content type come back **from Storage**, so the row written
 * afterwards records what landed rather than what was claimed.
 */
export async function describeOwnUpload(
  authUserId: string,
  path: string,
): Promise<StoredDocument> {
  const match = PATH_PATTERN.exec(path);
  if (!match) {
    throw new KycStorageError("That document reference is not a valid key.");
  }
  if (match[1] !== authUserId) {
    // Never reachable through the UI. Reachable by hand, which is the point.
    throw new KycStorageError("That document belongs to another account.");
  }

  const supabase = await createSupabaseServerClient();

  // `list` on the object's own folder, filtered to its name. `download` would
  // pull the bytes across for no reason; this reads the metadata only.
  const separator = path.lastIndexOf("/");
  const folder = path.slice(0, separator);
  const fileName = path.slice(separator + 1);

  const { data, error } = await supabase.storage
    .from(KYC_BUCKET)
    .list(folder, { search: fileName, limit: 100 });

  if (error) {
    throw new KycStorageError(`The document could not be read: ${error.message}`);
  }

  const object = data?.find((entry) => entry.name === fileName);
  if (!object) {
    // Either the upload never completed or the policy hid it. Both mean there
    // is nothing to attach, and a submission must not claim otherwise.
    throw new KycStorageError("That document was not found in storage.");
  }

  const metadata = object.metadata as
    | { size?: number; mimetype?: string }
    | null
    | undefined;
  const byteSize = typeof metadata?.size === "number" ? metadata.size : 0;
  const contentType = metadata?.mimetype ?? "application/octet-stream";

  /*
   * Re-checked here even though the bucket enforces both.
   *
   * The bucket's limits are the enforcement; these are the assertion. If
   * somebody widens `allowed_mime_types` in the dashboard without changing this
   * application, the mismatch surfaces as a refused submission rather than as
   * an executable quietly filed as a passport.
   */
  if (byteSize <= 0) {
    throw new KycStorageError("That document is empty.");
  }
  if (byteSize > MAX_DOCUMENT_BYTES) {
    throw new KycStorageError("That document is larger than 10 MB.");
  }
  if (!ACCEPTED_MIME_TYPES.includes(contentType as (typeof ACCEPTED_MIME_TYPES)[number])) {
    throw new KycStorageError(`Files of type ${contentType} are not accepted.`);
  }

  return { path, contentType, byteSize };
}

/**
 * A short-lived URL for one document.
 *
 * Signed rather than public: the bucket has `public = false`, so an object has
 * no reachable URL of its own. A signature is minted per view, expires, and is
 * only issued at all when the caller's session satisfies a storage read policy
 * — their own folder, or the whole bucket for an active KYC operator.
 *
 * **Authorization is the caller's job before calling this.** The storage policy
 * is the backstop; the CRM checks `requirePermission("kyc")` first so an
 * operator without the grant never gets this far, and the user application only
 * ever passes a path it read from that account's own submission.
 */
export async function signKycDocument(
  path: string,
  expiresInSeconds = 60,
): Promise<string> {
  const supabase = await createSupabaseServerClient();

  const { data, error } = await supabase.storage
    .from(KYC_BUCKET)
    .createSignedUrl(path, expiresInSeconds);

  if (error || !data?.signedUrl) {
    throw new KycStorageError(
      `The document link could not be created: ${error?.message ?? "unknown error"}`,
    );
  }
  return data.signedUrl;
}
