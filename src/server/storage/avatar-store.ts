import "server-only";

import { randomUUID } from "node:crypto";

import { GetObjectCommand, HeadObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { readS3KycConfig, s3For } from "./s3-kyc-store";

/**
 * Customer profile photos, in the same PRIVATE S3 bucket as KYC documents
 * (`KYC_STORAGE_DRIVER=s3`, `KYC_S3_BUCKET`, `KYC_S3_REGION`) under their own
 * prefix: `avatars/{userId}/{uuid}`.
 *
 * Same rules as `s3-kyc-store`: the browser PUTs to a 5-minute presigned URL
 * that signs the exact type and size; the server picks the key, refuses any
 * key outside the caller's own prefix, and checks what landed (HeadObject)
 * before storing it; nothing is ever public — the photo is shown through a
 * short-lived presigned GET. No credentials are read here (EC2 instance role).
 *
 * The photo is optional. With S3 not configured, `isAvatarUploadAvailable()`
 * is false and the onboarding screen simply does not offer it.
 */

export const AVATAR_PREFIX = "avatars";
export const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
export const AVATAR_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export class AvatarStorageError extends Error {
  constructor(message: string) {
    super(message);
    // Reuses an allowlisted name so its fixed sentences can reach the person.
    this.name = "KycStorageError";
  }
}

export function isAvatarUploadAvailable(): boolean {
  return readS3KycConfig() !== null;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** Whether `key` is one this account could have been issued. Pure. */
export function isOwnAvatarKey(key: unknown, userId: string): key is string {
  if (typeof key !== "string") return false;
  const escaped = userId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${AVATAR_PREFIX}/${escaped}/${UUID}$`).test(key);
}

export async function createAvatarUploadTarget(request: {
  userId: string;
  contentType: string;
  byteSize: number;
}): Promise<{ key: string; url: string; headers: Record<string, string> }> {
  const config = readS3KycConfig();
  if (!config) throw new AvatarStorageError("Photo upload is not available right now.");
  if (!AVATAR_TYPES.includes(request.contentType as (typeof AVATAR_TYPES)[number])) {
    throw new AvatarStorageError("Use a JPEG, PNG or WebP photo.");
  }
  if (!Number.isInteger(request.byteSize) || request.byteSize <= 0) {
    throw new AvatarStorageError("That photo is empty.");
  }
  if (request.byteSize > MAX_AVATAR_BYTES) {
    throw new AvatarStorageError("That photo is larger than 5 MB.");
  }

  const key = `${AVATAR_PREFIX}/${request.userId}/${randomUUID()}`;
  const url = await getSignedUrl(
    s3For(config),
    new PutObjectCommand({
      Bucket: config.bucket,
      Key: key,
      ContentType: request.contentType,
      ContentLength: request.byteSize,
      ServerSideEncryption: config.serverSideEncryption,
      SSEKMSKeyId: config.kmsKeyId,
    }),
    { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) },
  );

  const headers: Record<string, string> = { "Content-Type": request.contentType };
  const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  if (signed.includes("x-amz-server-side-encryption")) {
    headers["x-amz-server-side-encryption"] = config.serverSideEncryption;
    if (config.kmsKeyId && signed.includes("x-amz-server-side-encryption-aws-kms-key-id")) {
      headers["x-amz-server-side-encryption-aws-kms-key-id"] = config.kmsKeyId;
    }
  }
  return { key, url, headers };
}

/** Confirms what landed at `key` is a photo within the limits. */
export async function verifyAvatarObject(key: string): Promise<void> {
  const config = readS3KycConfig();
  if (!config) throw new AvatarStorageError("Photo upload is not available right now.");
  let head;
  try {
    head = await s3For(config).send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }));
  } catch {
    throw new AvatarStorageError("The photo could not be found. Try uploading it again.");
  }
  const size = head.ContentLength ?? 0;
  if (size <= 0 || size > MAX_AVATAR_BYTES) throw new AvatarStorageError("That photo is not a valid size.");
  if (!AVATAR_TYPES.includes((head.ContentType ?? "") as (typeof AVATAR_TYPES)[number])) {
    throw new AvatarStorageError("Use a JPEG, PNG or WebP photo.");
  }
}

/**
 * A 15-minute read link for the account's own photo, or null when there is
 * none or S3 is not configured. Signing is local — no network round trip.
 */
export async function signAvatarUrl(key: string | null): Promise<string | null> {
  if (!key) return null;
  const config = readS3KycConfig();
  if (!config) return null;
  try {
    return await getSignedUrl(
      s3For(config),
      new GetObjectCommand({ Bucket: config.bucket, Key: key }),
      { expiresIn: 900 },
    );
  } catch {
    return null;
  }
}
