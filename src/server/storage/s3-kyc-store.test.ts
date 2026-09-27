import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";

import {
  createKycUploadTarget,
  isOwnKycKey,
  kycObjectKey,
  readS3KycConfig,
  type S3KycConfig,
} from "./s3-kyc-store";

/**
 * The S3 adapter's security properties, with no bucket and no credentials:
 * nothing here talks to AWS. Presigning is local (SigV4), so the signed URL
 * itself can be inspected.
 */
const ENV_KEYS = [
  "KYC_STORAGE_DRIVER",
  "KYC_S3_BUCKET",
  "KYC_S3_REGION",
  "AWS_REGION",
  "KYC_S3_PREFIX",
  "KYC_S3_KMS_KEY_ID",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

const config: S3KycConfig = {
  bucket: "example-kyc-bucket",
  region: "ap-south-1",
  prefix: "kyc",
  serverSideEncryption: "AES256",
  kmsKeyId: undefined,
};

describe("S3 KYC configuration", () => {
  test("is disabled unless the driver is named AND a bucket and region are set", () => {
    for (const key of ENV_KEYS) delete process.env[key];
    assert.equal(readS3KycConfig(), null, "nothing set");

    process.env.KYC_S3_BUCKET = "b";
    process.env.KYC_S3_REGION = "ap-south-1";
    assert.equal(readS3KycConfig(), null, "bucket without the driver never uploads");

    process.env.KYC_STORAGE_DRIVER = "s3";
    delete process.env.KYC_S3_BUCKET;
    assert.equal(readS3KycConfig(), null, "no default bucket is ever guessed");

    process.env.KYC_S3_BUCKET = "b";
    assert.equal(readS3KycConfig()?.bucket, "b");
    assert.equal(readS3KycConfig()?.serverSideEncryption, "AES256");
  });
});

describe("KYC object keys", () => {
  test("are opaque: prefix, account, kind, uuid — nothing from the file", () => {
    const key = kycObjectKey("kyc", "usr_abc", "document");
    assert.match(key, /^kyc\/usr_abc\/document\/[0-9a-f-]{36}$/);
    assert.equal(isOwnKycKey(key, "kyc", "usr_abc"), true);
  });

  test("a forged key is refused before storage is asked", () => {
    const mine = kycObjectKey("kyc", "usr_me", "selfie");
    const theirs = kycObjectKey("kyc", "usr_them", "document");
    assert.equal(isOwnKycKey(theirs, "kyc", "usr_me"), false, "another account");
    assert.equal(isOwnKycKey(`${mine}/../x`, "kyc", "usr_me"), false, "path walk");
    assert.equal(isOwnKycKey("kyc/usr_me/document/aadhaar-1234.jpg", "kyc", "usr_me"), false);
    assert.equal(isOwnKycKey("other/usr_me/document/" + mine.split("/").pop(), "kyc", "usr_me"), false);
    // A user id that is a prefix of another must not match it.
    assert.equal(isOwnKycKey(kycObjectKey("kyc", "usr_me2", "document"), "kyc", "usr_me"), false);
  });
});

describe("upload targets", () => {
  test("sign the exact type and size, and expire", async () => {
    process.env.AWS_ACCESS_KEY_ID = "AKIAEXAMPLEEXAMPLE00";
    process.env.AWS_SECRET_ACCESS_KEY = "example-secret-not-real";

    const target = await createKycUploadTarget(config, {
      userId: "usr_abc",
      kind: "document",
      contentType: "image/jpeg",
      byteSize: 12345,
    });
    const url = new URL(target.url);
    assert.equal(url.hostname.startsWith("example-kyc-bucket"), true);
    assert.equal(url.searchParams.get("X-Amz-Expires"), "300");
    const signed = url.searchParams.get("X-Amz-SignedHeaders") ?? "";
    assert.match(signed, /content-length/);
    assert.match(signed, /content-type/);
    // No ACL is ever requested — the bucket stays private.
    assert.equal(url.searchParams.has("x-amz-acl"), false);
    assert.equal(target.headers["Content-Type"], "image/jpeg");
  });

  test("refuse types and sizes outside the policy before signing anything", async () => {
    await assert.rejects(
      createKycUploadTarget(config, {
        userId: "u",
        kind: "document",
        contentType: "application/x-msdownload",
        byteSize: 10,
      }),
      /not accepted/,
    );
    await assert.rejects(
      createKycUploadTarget(config, {
        userId: "u",
        kind: "document",
        contentType: "image/png",
        byteSize: 10 * 1024 * 1024 + 1,
      }),
      /10 MB/,
    );
  });
});
