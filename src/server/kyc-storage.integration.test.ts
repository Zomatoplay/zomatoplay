import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { getTableName, inArray, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";
import * as schema from "@/db/schema";

/**
 * The private KYC document bucket, against the real Supabase project.
 *
 * WHAT THIS IS ACTUALLY TESTING
 * -----------------------------
 * Not application code — **the storage policies**. Uploads go straight from the
 * browser to Supabase Storage, so the only thing standing between one person's
 * identity documents and another person's session is the RLS on
 * `storage.objects`. That makes the policies the security boundary, and a
 * boundary nothing exercises is a boundary nobody knows the state of.
 *
 * Every call below is a raw HTTP request carrying a **real user JWT**, exactly
 * as a browser would make it. Nothing here runs as `postgres`, because
 * `postgres` bypasses RLS and would pass every one of these tests while the
 * bucket stood wide open.
 *
 * Skipped without Supabase or a database configured.
 */

const env = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL?.trim(),
  anonKey:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
  userEmail: process.env.DEV_TEST_EMAIL?.trim(),
  userPassword: process.env.DEV_TEST_PASSWORD?.trim(),
  operatorEmail: process.env.DEV_ADMIN_EMAIL?.trim(),
  operatorPassword: process.env.DEV_ADMIN_PASSWORD?.trim(),
};

const skip = !isDatabaseConfigured()
  ? "no DATABASE_URL configured"
  : !env.url || !env.anonKey
    ? "Supabase is not configured"
    : !env.userEmail || !env.operatorEmail
      ? "DEV_TEST_* / DEV_ADMIN_* credentials are not configured"
      : false;

const BUCKET = "kyc-documents";

/** A one-pixel PNG. Small, and genuinely of an accepted type. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

interface Principal {
  token: string;
  authUserId: string;
}

async function signIn(email: string, password: string): Promise<Principal> {
  const response = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      apikey: env.anonKey!,
      Authorization: `Bearer ${env.anonKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password }),
  });
  const body = (await response.json()) as {
    access_token?: string;
    user?: { id?: string };
  };
  assert.ok(
    response.ok && body.access_token && body.user?.id,
    `could not sign in ${email}: ${response.status}`,
  );
  return { token: body.access_token, authUserId: body.user.id };
}

/**
 * Uploads bytes as a given principal.
 *
 * Returns the HTTP status *and* the error code Storage puts in the body.
 * Storage answers a rejected upload with a 400 envelope carrying the real
 * reason — `InvalidMimeType`, `EntityTooLarge` — so the code is both more
 * specific than the status and more stable than it.
 */
async function upload(
  principal: Principal | null,
  path: string,
  bytes: Buffer,
  contentType: string,
): Promise<{ status: number; code: string | null }> {
  const response = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "POST",
    headers: {
      apikey: env.anonKey!,
      ...(principal ? { Authorization: `Bearer ${principal.token}` } : {}),
      "Content-Type": contentType,
    },
    body: new Uint8Array(bytes),
  });
  // Drained so the connection is reusable and node:test does not hang on it.
  const text = await response.text();
  let code: string | null = null;
  try {
    code = (JSON.parse(text) as { code?: string }).code ?? null;
  } catch {
    // A non-JSON body is fine; the status carries the answer.
  }
  return { status: response.status, code };
}

async function download(principal: Principal | null, path: string): Promise<number> {
  const response = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    headers: {
      apikey: env.anonKey!,
      ...(principal ? { Authorization: `Bearer ${principal.token}` } : {}),
    },
  });
  await response.arrayBuffer();
  return response.status;
}

async function sign(principal: Principal, path: string): Promise<number> {
  const response = await fetch(
    `${env.url}/storage/v1/object/sign/${BUCKET}/${path}`,
    {
      method: "POST",
      headers: {
        apikey: env.anonKey!,
        Authorization: `Bearer ${principal.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ expiresIn: 60 }),
    },
  );
  await response.text();
  return response.status;
}

async function remove(principal: Principal, path: string): Promise<number> {
  const response = await fetch(`${env.url}/storage/v1/object/${BUCKET}/${path}`, {
    method: "DELETE",
    headers: {
      apikey: env.anonKey!,
      Authorization: `Bearer ${principal.token}`,
    },
  });
  await response.text();
  return response.status;
}

describe("kyc document storage", { skip }, () => {
  let db: Database;
  let user: Principal;
  let operator: Principal;
  /** Everything written here, cleaned up in `after`. */
  const written: string[] = [];
  const createdDocumentIds: string[] = [];

  function keyFor(owner: Principal, label: string): string {
    const key = `${owner.authUserId}/test-${label}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}.png`;
    written.push(key);
    return key;
  }

  before(async () => {
    db = createAdminDb();
    user = await signIn(env.userEmail!, env.userPassword!);
    operator = await signIn(env.operatorEmail!, env.operatorPassword!);
  });

  after(async () => {
    // Rows first: an object cannot be deleted while a `kyc_documents` row
    // points at it, which is exactly the policy being tested.
    if (createdDocumentIds.length > 0) {
      await db
        .delete(t.kycDocuments)
        .where(inArray(t.kycDocuments.id, createdDocumentIds));
    }
    for (const key of written) {
      await remove(user, key).catch(() => undefined);
    }
    await closeAdminDb(db);
  });

  /* ------------------------------------------------------------------ */
  /* Upload                                                              */
  /* ------------------------------------------------------------------ */

  test("a person can upload an accepted file into their own folder", async () => {
    const { status } = await upload(user, keyFor(user, "valid"), PNG, "image/png");
    assert.equal(status, 200, "a PNG under the size limit is accepted");
  });

  test("a disallowed file type is refused by the bucket, not by the app", async () => {
    const { code } = await upload(
      user,
      keyFor(user, "badtype").replace(/\.png$/, ".txt"),
      Buffer.from("not an identity document"),
      "text/plain",
    );
    /*
     * Refused by Storage's own `allowed_mime_types`. The point is *where* this
     * is enforced: no application code ran, so a client that skips the UI
     * entirely still cannot put an executable or a script in the bucket.
     */
    assert.equal(code, "InvalidMimeType", "text/plain is refused by the bucket");
  });

  test("an oversized file is refused by the bucket", async () => {
    // One byte past the bucket's 10 MB `file_size_limit`.
    const tooBig = Buffer.alloc(10 * 1024 * 1024 + 1, 0);
    const { code } = await upload(user, keyFor(user, "toobig"), tooBig, "image/png");
    assert.equal(code, "EntityTooLarge", "the bucket enforces its own size limit");
  });

  test("a person cannot upload into another account's folder", async () => {
    // A hand-built key aimed at the operator's folder — the shape a tampered
    // client would send. Not registered for cleanup: it must never exist.
    const trespass = `${operator.authUserId}/trespass-${Date.now()}.png`;
    const { status } = await upload(user, trespass, PNG, "image/png");
    assert.ok(
      status >= 400,
      `writing into another folder must be refused, got ${status}`,
    );
    assert.equal(
      await download(operator, trespass),
      400,
      "and nothing was written there",
    );
  });

  test("an anonymous caller cannot upload at all", async () => {
    const anonymous = `${user.authUserId}/anon-${Date.now()}.png`;
    const { status } = await upload(null, anonymous, PNG, "image/png");
    assert.ok(status >= 400, `an anonymous upload must be refused, got ${status}`);
  });

  /* ------------------------------------------------------------------ */
  /* Read                                                                */
  /* ------------------------------------------------------------------ */

  test("a person can read their own document; nobody else can", async () => {
    const key = keyFor(user, "read");
    assert.equal((await upload(user, key, PNG, "image/png")).status, 200);

    assert.equal(await download(user, key), 200, "the owner reads it");
    assert.equal(
      await download(null, key),
      400,
      "an anonymous caller does not — the bucket is private",
    );
  });

  test("a KYC operator can sign a link to somebody else's document", async () => {
    const key = keyFor(user, "operator");
    assert.equal((await upload(user, key, PNG, "image/png")).status, 200);

    /*
     * The operator has no relationship to this folder; `is_kyc_operator()` is
     * what grants the read. This is the CRM's review path, minus the
     * `requirePermission("kyc")` check that runs before it in the action.
     */
    assert.equal(await sign(operator, key), 200, "an operator can sign it");
    assert.equal(await download(operator, key), 200, "and read it");
  });

  test("a signature cannot be minted for a document you cannot read", async () => {
    // The operator's folder, from the customer's session.
    const key = `${operator.authUserId}/not-yours-${Date.now()}.png`;
    const status = await sign(user, key);
    assert.ok(status >= 400, `signing another account's object must fail, got ${status}`);
  });

  /* ------------------------------------------------------------------ */
  /* Lifecycle                                                           */
  /* ------------------------------------------------------------------ */

  test("an unsubmitted upload can be cleaned up; a submitted one cannot", async () => {
    const abandoned = keyFor(user, "abandoned");
    const attached = keyFor(user, "attached");
    assert.equal((await upload(user, abandoned, PNG, "image/png")).status, 200);
    assert.equal((await upload(user, attached, PNG, "image/png")).status, 200);

    // Attach the second one to a real submission row, as `submitKyc` would.
    const [submission] = await db
      .select({ id: t.kycSubmissions.id })
      .from(t.kycSubmissions)
      .limit(1);
    assert.ok(submission, "the database has at least one submission to attach to");

    const documentId = `kyd_test_${Date.now()}`;
    await db.insert(t.kycDocuments).values({
      id: documentId,
      submissionId: submission.id,
      label: "Storage test",
      type: "national_id",
      fileName: "test.png",
      storagePath: attached,
      contentType: "image/png",
      byteSize: PNG.length,
      uploadedAt: new Date(),
      pages: 1,
    });
    createdDocumentIds.push(documentId);

    assert.equal(
      await remove(user, abandoned),
      200,
      "an upload nothing points at can be withdrawn",
    );

    /*
     * The property that matters.
     *
     * Once a document is attached to a submission it is evidence a reviewer may
     * act on, and the person it describes must not be able to delete it out
     * from under them.
     */
    const status = await remove(user, attached);
    assert.ok(
      status >= 400,
      `a submitted document must not be deletable by its subject, got ${status}`,
    );
    assert.equal(
      await download(user, attached),
      200,
      "and it is still there afterwards",
    );
  });

  test("a resubmission writes a new object rather than replacing one", async () => {
    const first = keyFor(user, "resubmit-1");
    assert.equal((await upload(user, first, PNG, "image/png")).status, 200);

    // The same key again is what an "overwrite" would look like. There is no
    // UPDATE policy, so Storage refuses it and the original is untouched.
    const again = await upload(user, first, PNG, "image/png");
    assert.ok(again.status >= 400, `overwriting must fail, got ${again.status}`);

    const second = keyFor(user, "resubmit-2");
    assert.equal(
      (await upload(user, second, PNG, "image/png")).status,
      200,
      "a resubmission uses a fresh key",
    );
    assert.equal(await download(user, first), 200, "the earlier document survives");
  });
});

/**
 * The PostgREST hole `db:secure` closed.
 *
 * Supabase publishes `public` over HTTP and grants `anon` SELECT on it. Every
 * application table had RLS off, so a `GET /rest/v1/users` with the anon key —
 * which is inlined into the browser bundle — returned names, emails, phone
 * numbers, balances and KYC submissions. This is the regression test.
 */
describe("postgrest exposure", { skip }, () => {
  /**
   * EVERY table in the schema, derived rather than listed.
   *
   * It used to be a hand-written list of thirteen, and a hand-written list is
   * a list somebody forgets to add to. `deposit_address_assignments` — which
   * maps a blockchain address to the user who held it, and to when, so it is
   * precisely the attribution mechanism CLAUDE.md §18.8 says must never be
   * enumerable — shipped with RLS off and this suite stayed green, because the
   * new table was not in the list.
   *
   * Deriving it from `@/db/schema` makes "migrate, then secure" a test rather
   * than a rule to remember: a table added without `npm run db:secure` fails
   * here on the next run.
   */
  const TABLES = Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((value) => getTableName(value as PgTable))
    .sort();

  async function readAs(token: string, table: string) {
    const response = await fetch(
      `${env.url}/rest/v1/${table}?select=*&limit=1`,
      { headers: { apikey: env.anonKey!, Authorization: `Bearer ${token}` } },
    );
    const body = await response.text();
    return { status: response.status, body };
  }

  test("an anonymous caller reads nothing from any application table", async () => {
    for (const table of TABLES) {
      const { status, body } = await readAs(env.anonKey!, table);
      assert.ok(
        status === 200 ? body.trim() === "[]" : status >= 400,
        `${table} leaked to anon: ${status} ${body.slice(0, 120)}`,
      );
    }
  });

  test("a signed-in customer reads nothing either", async () => {
    const principal = await signIn(env.userEmail!, env.userPassword!);
    for (const table of TABLES) {
      const { status, body } = await readAs(principal.token, table);
      assert.ok(
        status === 200 ? body.trim() === "[]" : status >= 400,
        `${table} leaked to an authenticated user: ${status} ${body.slice(0, 120)}`,
      );
    }
  });
});
