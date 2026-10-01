import "server-only";

/**
 * What a verification submission must carry.
 *
 * BOTH FILES ARE REQUIRED
 * -----------------------
 * A submission is an identity document **and** a live photo of the person,
 * and nothing less reaches the review queue. This used to be a switch
 * (`KYC_REQUIRE_DOCUMENTS`, off) so that a deployment without a document store
 * could still accept declared details; production has the S3 store, and a
 * case a reviewer cannot compare against a face is not a reviewable case.
 *
 * The rules are pure functions so they are tested directly
 * (`kyc-policy.test.ts`), and they are applied twice: by the server action,
 * against what the browser *claimed*, and again by `submitKyc`, against what
 * storage *recorded* — so a caller that skips the action still cannot write a
 * case with a missing or wrong-kind file.
 *
 * WHAT THESE RULES DO NOT DO
 * --------------------------
 * - Decide that a file is genuine. That is the reviewer's job (and, later, a
 *   provider's). `liveness_check_passed` stays false — nothing here performs a
 *   liveness check, so nothing here may claim one passed (CLAUDE.md §23).
 * - Trust the browser. Sizes and types are taken from storage after upload
 *   (`verifyOwnKycUpload`); the claim is only the cheap first refusal.
 */

/** 10 MB — the presigned upload's signed limit. */
export const MAX_KYC_FILE_BYTES = 10 * 1024 * 1024;

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"] as const;

/** A document may be a photo or a scanned PDF. */
export const KYC_DOCUMENT_TYPES: readonly string[] = [...IMAGE_TYPES, "application/pdf"];

/** A selfie is a photograph. A PDF of a face is not a live capture. */
export const KYC_SELFIE_TYPES: readonly string[] = IMAGE_TYPES;

export type KycFileKind = "document" | "selfie";

export interface KycFileFacts {
  contentType: string;
  byteSize: number;
}

/**
 * Why a stored (or claimed) file is not acceptable as `kind`, or null.
 *
 * Used for both halves: the browser's claim before any storage call, and the
 * object's real metadata afterwards.
 */
export function kycFileRefusal(kind: KycFileKind, file: KycFileFacts): string | null {
  const label = kind === "document" ? "identity document" : "live photo";
  if (!Number.isFinite(file.byteSize) || file.byteSize <= 0) {
    return `Your ${label} is empty. Take or choose it again.`;
  }
  if (file.byteSize > MAX_KYC_FILE_BYTES) {
    return `Your ${label} is larger than 10 MB.`;
  }
  const allowed = kind === "document" ? KYC_DOCUMENT_TYPES : KYC_SELFIE_TYPES;
  if (!allowed.includes(file.contentType)) {
    return kind === "document"
      ? "Your identity document must be a photo (JPG, PNG, WebP, HEIC) or a PDF."
      : "Your live photo must be a photo (JPG, PNG, WebP or HEIC).";
  }
  return null;
}

/**
 * Why a submission's file references are incomplete, or null.
 *
 * A reference is a storage key plus a filename; either missing means the file
 * was never uploaded, whatever the screen showed.
 */
export function missingKycFilesRefusal(input: {
  documentPath?: string | null;
  documentFileName?: string | null;
  selfiePath?: string | null;
  selfieFileName?: string | null;
}): string | null {
  if (!input.documentPath?.trim() || !input.documentFileName?.trim()) {
    return "Upload a photo of your identity document.";
  }
  if (!input.selfiePath?.trim() || !input.selfieFileName?.trim()) {
    return "Take a live photo of yourself.";
  }
  if (input.documentPath.trim() === input.selfiePath.trim()) {
    return "Your live photo must be a separate photo from your document.";
  }
  return null;
}
