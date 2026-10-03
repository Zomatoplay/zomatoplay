import "server-only";

import { randomUUID } from "node:crypto";

import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import {
  ACCEPTED_MIME_TYPES,
  KycStorageError,
  MAX_DOCUMENT_BYTES,
  type StoredDocument,
} from "./kyc-storage";

/**
 * Private AWS S3 storage for KYC documents.
 *
 *   browser ──(presigned PUT, 5 min)──▶ s3://bucket/kyc/{userId}/{kind}/{uuid}
 *   server  ──(HeadObject)──▶ verifies what landed before any row claims it
 *   reviewer ──(presigned GET, 2 min, after requirePermission)──▶ the object
 *
 * THE BUCKET IS NEVER PUBLIC, AND NOTHING HERE MAKES IT SO
 * --------------------------------------------------------
 * No object ACL is ever set; the bucket is expected to have Block Public Access
 * on and ownership enforced (see `docs` in CLAUDE.md §16.1c). A person never
 * receives a permanent URL — only a signed one that expires in minutes and was
 * minted after the server checked who is asking.
 *
 * WHY THE BROWSER UPLOADS DIRECTLY
 * --------------------------------
 * The file never passes through this process: a 10 MB scan through a server
 * action is 10 MB of request body on a Node process that also serves every
 * page. The presigned PUT signs the **content type and exact byte length**, so
 * S3 itself refuses a body larger than the server approved or of a different
 * type — the enforcement is AWS's, not a check this code has to remember.
 *
 * THE KEY IS OPAQUE AND CHOSEN BY THE SERVER
 * ------------------------------------------
 * `kyc/{userId}/{kind}/{uuid}` — no filename, no document number, nothing an
 * S3 listing or an access log could leak. The browser never picks a key; it is
 * handed one, and a submission naming any key outside its own account's prefix
 * is refused before S3 is even asked.
 *
 * CREDENTIALS
 * -----------
 * None are read here. The AWS SDK's default provider chain finds them — on EC2
 * that is the **instance role** via IMDSv2, which is the recommended setup: no
 * long-lived key exists to leak. Static `AWS_ACCESS_KEY_ID` /
 * `AWS_SECRET_ACCESS_KEY` also work (server env only) but are not advised.
 *
 * DISABLED UNTIL EXPLICITLY ENABLED
 * ---------------------------------
 * Nothing uploads anywhere unless `KYC_STORAGE_DRIVER=s3` AND a bucket and
 * region are named. There is no default bucket: guessing one is how identity
 * documents end up somewhere nobody meant them to be.
 */

export type KycObjectKind = "document" | "selfie";

export interface S3KycConfig {
  bucket: string;
  region: string;
  prefix: string;
  /** `AES256` (S3-managed) or `aws:kms`. */
  serverSideEncryption: "AES256" | "aws:kms";
  kmsKeyId: string | undefined;
}

export function readS3KycConfig(): S3KycConfig | null {
  if (process.env.KYC_STORAGE_DRIVER?.trim().toLowerCase() !== "s3") return null;
  const bucket = process.env.KYC_S3_BUCKET?.trim();
  const region = (process.env.KYC_S3_REGION ?? process.env.AWS_REGION)?.trim();
  if (!bucket || !region) return null;

  const kmsKeyId = process.env.KYC_S3_KMS_KEY_ID?.trim() || undefined;
  return {
    bucket,
    region,
    prefix: (process.env.KYC_S3_PREFIX?.trim() || "kyc").replace(/^\/+|\/+$/g, ""),
    serverSideEncryption: kmsKeyId ? "aws:kms" : "AES256",
    kmsKeyId,
  };
}

let client: { region: string; s3: S3Client } | null = null;

export function s3For(config: S3KycConfig): S3Client {
  if (client?.region !== config.region) {
    client = { region: config.region, s3: new S3Client({ region: config.region }) };
  }
  return client.s3;
}

/** The only key shape this application writes or accepts. */
export function kycObjectKey(prefix: string, userId: string, kind: KycObjectKind): string {
  return `${prefix}/${userId}/${kind}/${randomUUID()}`;
}

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/**
 * Whether `key` is one this account could have been issued — and, when `kind`
 * is given, issued for that kind of file.
 *
 * Checked before any call to S3, so a forged key — another account's prefix, a
 * `../` walk, a bare bucket path — is refused without revealing whether an
 * object exists there. The kind matters too: the key a document slot issued
 * must not be accepted as the selfie, or one photo could satisfy both.
 */
export function isOwnKycKey(
  key: string,
  prefix: string,
  userId: string,
  kind?: KycObjectKind,
): boolean {
  const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `^${escape(prefix)}/${escape(userId)}/(${kind ?? "document|selfie"})/${UUID}$`,
  ).test(key);
}

export interface UploadTarget {
  key: string;
  url: string;
  /** Headers the PUT must carry exactly — they are part of the signature. */
  headers: Record<string, string>;
  expiresInSeconds: number;
}

/** A single-use upload slot for one file. Validates before signing. */
export async function createKycUploadTarget(
  config: S3KycConfig,
  request: { userId: string; kind: KycObjectKind; contentType: string; byteSize: number },
): Promise<UploadTarget> {
  if (!ACCEPTED_MIME_TYPES.includes(request.contentType as (typeof ACCEPTED_MIME_TYPES)[number])) {
    throw new KycStorageError("That file type is not accepted.");
  }
  if (!Number.isInteger(request.byteSize) || request.byteSize <= 0) {
    throw new KycStorageError("That file is empty.");
  }
  if (request.byteSize > MAX_DOCUMENT_BYTES) {
    throw new KycStorageError("That file is larger than the 10 MB limit.");
  }

  const key = kycObjectKey(config.prefix, request.userId, request.kind);
  const expiresInSeconds = 300;

  const command = new PutObjectCommand({
    Bucket: config.bucket,
    Key: key,
    ContentType: request.contentType,
    ContentLength: request.byteSize,
    ServerSideEncryption: config.serverSideEncryption,
    SSEKMSKeyId: config.kmsKeyId,
  });

  const url = await getSignedUrl(s3For(config), command, {
    expiresIn: expiresInSeconds,
    // Sign these so S3 rejects a body that differs from what was approved.
    signableHeaders: new Set(["content-type", "content-length"]),
  });

  const headers: Record<string, string> = { "Content-Type": request.contentType };
  // Encryption headers, when present in the signature, must be sent too.
  const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
  if (signed.includes("x-amz-server-side-encryption")) {
    headers["x-amz-server-side-encryption"] = config.serverSideEncryption;
    if (config.kmsKeyId && signed.includes("x-amz-server-side-encryption-aws-kms-key-id")) {
      headers["x-amz-server-side-encryption-aws-kms-key-id"] = config.kmsKeyId;
    }
  }

  return { key, url, headers, expiresInSeconds };
}

/**
 * What actually landed at `key` — size and type as S3 recorded them.
 *
 * The caller must already have checked `isOwnKycKey`; this re-checks the
 * limits because they are the assertion, whatever a policy allowed.
 */
export async function describeKycObject(
  config: S3KycConfig,
  key: string,
): Promise<StoredDocument> {
  let head;
  try {
    head = await s3For(config).send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: key }),
    );
  } catch (error) {
    if (error instanceof S3ServiceException && error.$metadata.httpStatusCode === 404) {
      throw new KycStorageError("That document was not found in storage.");
    }
    throw new KycStorageError("The document could not be verified. Try again.");
  }

  const byteSize = head.ContentLength ?? 0;
  const contentType = head.ContentType ?? "application/octet-stream";
  if (byteSize <= 0) throw new KycStorageError("That document is empty.");
  if (byteSize > MAX_DOCUMENT_BYTES) {
    throw new KycStorageError("That document is larger than 10 MB.");
  }
  if (!ACCEPTED_MIME_TYPES.includes(contentType as (typeof ACCEPTED_MIME_TYPES)[number])) {
    throw new KycStorageError(`Files of type ${contentType} are not accepted.`);
  }
  return { path: key, contentType, byteSize };
}

/** A short-lived read link for a reviewer. Only called after a permission check. */
export async function signKycObjectDownload(
  config: S3KycConfig,
  key: string,
  expiresInSeconds = 120,
): Promise<string> {
  return getSignedUrl(
    s3For(config),
    new GetObjectCommand({ Bucket: config.bucket, Key: key }),
    { expiresIn: expiresInSeconds },
  );
}
