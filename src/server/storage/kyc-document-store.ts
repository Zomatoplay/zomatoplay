import "server-only";

import { isAuthConfigured } from "@/lib/supabase/env";
import type { KycUploadMode } from "@/types";

import {
  describeOwnUpload,
  KycStorageError,
  signKycDocument,
  type StoredDocument,
} from "./kyc-storage";
import {
  createKycUploadTarget,
  describeKycObject,
  isOwnKycKey,
  readS3KycConfig,
  signKycObjectDownload,
  type KycObjectKind,
  type UploadTarget,
} from "./s3-kyc-store";

/**
 * Which store a KYC document goes to, and the one place that decides.
 *
 *   s3          AWS S3, private bucket — the target on EC2 (KYC_STORAGE_DRIVER=s3)
 *   supabase    the original private Supabase bucket. Legacy: it authorises by
 *               the uploader's *Supabase* session, so only an email-signed-in
 *               customer can use it.
 *   unavailable neither — documents cannot be attached right now, and the flow
 *               says so instead of offering a button that fails. Declared
 *               details still submit, because documents are optional (§23).
 *
 * Rows record which store they live in (`kyc_documents.storage_backend`), so a
 * reviewer can open a document uploaded before the move to S3.
 */
export type { KycUploadMode };
export type KycStorageBackend = "s3" | "supabase";

interface CustomerForStorage {
  userId: string;
  authUserId: string | null;
  signInMethod: "phone" | "email";
}

export function kycUploadModeFor(account: CustomerForStorage): KycUploadMode {
  if (readS3KycConfig()) return "s3";

  const driver = process.env.KYC_STORAGE_DRIVER?.trim().toLowerCase();
  // `s3` named but incomplete is a misconfiguration: refuse rather than fall
  // back to a different store the operator did not choose.
  if (driver === "s3" || driver === "disabled") return "unavailable";

  if (isAuthConfigured() && account.signInMethod === "email" && account.authUserId) {
    return "supabase";
  }
  return "unavailable";
}

/** An S3 upload slot for this account. Refuses unless S3 is the configured store. */
export async function issueKycUploadTarget(
  account: CustomerForStorage,
  request: { kind: KycObjectKind; contentType: string; byteSize: number },
): Promise<UploadTarget> {
  const config = readS3KycConfig();
  if (!config) {
    throw new KycStorageError("Document upload is not available right now.");
  }
  return createKycUploadTarget(config, { userId: account.userId, ...request });
}

/**
 * Verifies an object the caller claims to have uploaded, in whichever store
 * the key belongs to. Ownership first, then existence, size and type — as
 * the store recorded them.
 */
export async function verifyOwnKycUpload(
  account: CustomerForStorage,
  key: string,
  kind: KycObjectKind,
): Promise<StoredDocument & { backend: KycStorageBackend }> {
  const s3 = readS3KycConfig();
  if (s3 && key.startsWith(`${s3.prefix}/`)) {
    if (!isOwnKycKey(key, s3.prefix, account.userId, kind)) {
      // Never reachable through the UI. Reachable by hand, which is the point:
      // another account's key, or this account's document offered as a selfie.
      throw new KycStorageError("That upload does not belong to this verification.");
    }
    return { ...(await describeKycObject(s3, key)), backend: "s3" };
  }

  if (account.signInMethod !== "email" || !account.authUserId) {
    throw new KycStorageError("That document reference is not a valid key.");
  }
  // Legacy keys are `{authUid}/{kind}-{timestamp}-{random}.{ext}`.
  if (!key.slice(key.lastIndexOf("/") + 1).startsWith(`${kind}-`)) {
    throw new KycStorageError("That document reference is not a valid key.");
  }
  return { ...(await describeOwnUpload(account.authUserId, key)), backend: "supabase" };
}

/** A short-lived link for a reviewer. The caller has already checked permission. */
export async function signStoredKycDocument(
  path: string,
  backend: string,
  expiresInSeconds = 120,
): Promise<string> {
  if (backend === "s3") {
    const config = readS3KycConfig();
    if (!config) {
      throw new KycStorageError(
        "This document is in S3, and S3 storage is not configured on this server.",
      );
    }
    return signKycObjectDownload(config, path, expiresInSeconds);
  }
  return signKycDocument(path, expiresInSeconds);
}
