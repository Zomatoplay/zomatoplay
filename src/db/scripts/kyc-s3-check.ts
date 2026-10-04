import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Checks the whole KYC / profile-photo upload path against the real bucket,
 * from the machine it runs on (the EC2 host):
 *
 *   npm run kyc:s3-check
 *   npm run kyc:s3-check -- --origin https://zomatoplay.com
 *
 *   1. configuration     KYC_STORAGE_DRIVER=s3, bucket and region present
 *   2. presigned PUT     signs exactly as the app does (type, length, SSE) and
 *                        uploads a 1 KB test file under kyc/ and avatars/ —
 *                        proves the instance role may PutObject on both
 *   3. HeadObject        what the submission does to verify an upload
 *   4. presigned GET     what a reviewer's "open document" link does
 *   5. CORS preflight    what the BROWSER asks S3 before its PUT. EC2 reaching
 *                        S3 says nothing about this: without a CORS rule for
 *                        the site's origin, S3 refuses the preflight and the
 *                        browser reports the upload as a network failure
 *                        ("check your connection") although nothing is wrong
 *                        with the connection.
 *   6. cleanup           deletes the test objects; a role without
 *                        s3:DeleteObject leaves them under `_healthcheck/`,
 *                        which is harmless and reported.
 *
 * Prints no credential (there are none — the SDK uses the instance role) and
 * no presigned URL. Writes nothing to the database.
 */

const SAMPLE = new Uint8Array(1024).fill(0xff);

async function main() {
  const { readS3KycConfig, s3For } = await import("@/server/storage/s3-kyc-store");
  const { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } = await import(
    "@aws-sdk/client-s3"
  );
  const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
  const { randomUUID } = await import("node:crypto");

  const originArg = process.argv.indexOf("--origin");
  const origin = (
    (originArg > 0 ? process.argv[originArg + 1] : undefined) ??
    process.env.NEXT_PUBLIC_SITE_URL ??
    "https://zomatoplay.com"
  ).replace(/\/+$/, "");

  let failures = 0;
  const report = (ok: boolean, label: string, detail = "") => {
    if (!ok) failures += 1;
    console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? ` — ${detail}` : ""}`);
  };

  const config = readS3KycConfig();
  report(
    config !== null,
    "configuration",
    config
      ? `bucket ${config.bucket}, region ${config.region}, encryption ${config.serverSideEncryption}`
      : "set KYC_STORAGE_DRIVER=s3, KYC_S3_BUCKET and KYC_S3_REGION in the service environment",
  );
  if (!config) process.exit(1);
  const s3 = s3For(config);

  const keys: string[] = [];
  for (const prefix of [config.prefix, "avatars"]) {
    const key = `${prefix}/_healthcheck/${randomUUID()}`;
    const url = await getSignedUrl(
      s3,
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: key,
        ContentType: "image/jpeg",
        ContentLength: SAMPLE.byteLength,
        ServerSideEncryption: config.serverSideEncryption,
        SSEKMSKeyId: config.kmsKeyId,
      }),
      { expiresIn: 300, signableHeaders: new Set(["content-type", "content-length"]) },
    );
    const headers: Record<string, string> = { "Content-Type": "image/jpeg" };
    const signed = new URL(url).searchParams.get("X-Amz-SignedHeaders") ?? "";
    if (signed.includes("x-amz-server-side-encryption")) {
      headers["x-amz-server-side-encryption"] = config.serverSideEncryption;
      if (config.kmsKeyId && signed.includes("aws-kms-key-id")) {
        headers["x-amz-server-side-encryption-aws-kms-key-id"] = config.kmsKeyId;
      }
    }

    const put = await fetch(url, { method: "PUT", headers, body: SAMPLE }).catch(() => null);
    report(
      put?.ok === true,
      `presigned PUT to ${prefix}/`,
      put ? `HTTP ${put.status}` : "S3 could not be reached from this machine",
    );
    if (!put?.ok) continue;
    keys.push(key);

    if (prefix === config.prefix) {
      const head = await s3
        .send(new HeadObjectCommand({ Bucket: config.bucket, Key: key }))
        .then((value) => value)
        .catch((error: unknown) => (error instanceof Error ? error : new Error(String(error))));
      report(
        !(head instanceof Error) && head.ContentLength === SAMPLE.byteLength,
        "HeadObject (upload verification)",
        head instanceof Error ? head.name : `${head.ContentLength} bytes, ${head.ContentType}`,
      );

      const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), {
        expiresIn: 60,
      });
      const get = await fetch(getUrl).catch(() => null);
      report(get?.ok === true, "presigned GET (reviewer link)", get ? `HTTP ${get.status}` : "unreachable");

      // The browser's question, asked exactly as Chrome/Safari ask it.
      const preflight = await fetch(url, {
        method: "OPTIONS",
        headers: {
          Origin: origin,
          "Access-Control-Request-Method": "PUT",
          "Access-Control-Request-Headers": Object.keys(headers).map((h) => h.toLowerCase()).join(","),
        },
      }).catch(() => null);
      const allowed = preflight?.headers.get("access-control-allow-origin");
      report(
        preflight?.ok === true && (allowed === origin || allowed === "*"),
        `CORS preflight from ${origin}`,
        preflight?.ok
          ? `allowed origin: ${allowed ?? "none"}`
          : `HTTP ${preflight?.status ?? "—"}: add a CORS rule allowing PUT from ${origin} with headers ${Object.keys(headers).join(", ")}`,
      );
    }
  }

  let deleted = 0;
  for (const key of keys) {
    await s3
      .send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }))
      .then(() => (deleted += 1))
      .catch(() => {});
  }
  if (keys.length > 0) {
    console.log(
      deleted === keys.length
        ? "INFO  test objects deleted"
        : `INFO  ${keys.length - deleted} test object(s) left under _healthcheck/ (role has no DeleteObject) — harmless`,
    );
  }

  console.log(failures === 0 ? "\nAll checks passed." : `\n${failures} check(s) failed.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error: unknown) => {
  console.error("FAIL  unexpected error:", error instanceof Error ? error.name : "unknown");
  process.exit(1);
});
