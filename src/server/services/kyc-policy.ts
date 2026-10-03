import "server-only";

/**
 * What a verification submission must carry.
 *
 * UPLOADS ARE OPTIONAL (client decision, 2026-10)
 * -----------------------------------------------
 * A submission is the person's declared details (name, date of birth, the
 * document type and the last four characters of its number) from an account
 * with a verified mobile number. The identity-document photo/PDF and the live
 * photo are each OPTIONAL. What is NOT optional is honesty about them: a file
 * that is referenced must be a real upload — a key and a filename, distinct
 * from the other file, verified in storage — and a case without files is
 * labelled as such to the reviewer and to the customer. Submitting never
 * verifies anybody; only a reviewer's approval does.
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
 * Why a submission's (optional) file references are malformed, or null.
 *
 * Each file is optional, but a reference is a storage key PLUS a filename:
 * half of one means a file the screen showed and nothing uploaded, which is
 * refused rather than silently dropped. One object can never stand in for
 * both files.
 */
export function kycFileReferencesRefusal(input: {
  documentPath?: string | null;
  documentFileName?: string | null;
  selfiePath?: string | null;
  selfieFileName?: string | null;
}): string | null {
  const documentKey = input.documentPath?.trim() ?? "";
  const selfieKey = input.selfiePath?.trim() ?? "";
  if (Boolean(documentKey) !== Boolean(input.documentFileName?.trim())) {
    return "Your identity document did not finish uploading. Upload it again or remove it.";
  }
  if (Boolean(selfieKey) !== Boolean(input.selfieFileName?.trim())) {
    return "Your live photo did not finish uploading. Take it again or remove it.";
  }
  if (documentKey && documentKey === selfieKey) {
    return "Your live photo must be a separate photo from your document.";
  }
  return null;
}
