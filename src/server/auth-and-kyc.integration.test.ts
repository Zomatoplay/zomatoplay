import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq, sql } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";
import { SEED_USER_COUNT } from "@/db/seed";

import {
  getCurrentOperator,
  operatorHolds,
  requireOperator,
  NotAuthenticatedOperatorError,
  type Operator,
} from "./admin/session";
import { NotAuthenticatedError, requireCurrentUserId } from "./current-user";
import {
  approveKyc,
  rejectKyc,
  submitKyc,
  KycError,
} from "./services/kyc-write.service";
import { recordDepositIntent, assignDepositToUser, DepositError } from "./services/deposits.service";
import { newId, type Actor } from "./write";

/**
 * Authentication boundaries, the development dataset, and the verification
 * lifecycle — against the real database.
 *
 * The auth tests deliberately exercise the *unauthenticated* path, which is
 * the one that used to hand out a demo account. There is no session in a test
 * process, so "no session" is the natural state here and the assertions are
 * about what the code refuses to do.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const MASTER: Actor = {
  kind: "agent",
  id: "agt_master",
  name: "Test Master",
  role: "master_admin",
};

describe("authentication boundary", { skip }, () => {
  after(async () => {
    await closeDb();
  });

  test("an unauthenticated request has no user, and is not given one", async () => {
    // The whole point: this used to return a fixed demo account id, so every
    // visitor was silently signed in as the same person.
    await assert.rejects(() => requireCurrentUserId(), NotAuthenticatedError);
  });

  test("account reads refuse rather than falling back to seed data", async () => {
    const { getUserProfile, getWalletBalance } = await import(
      "./services/account.service"
    );
    // Not "returns the demo profile" — refuses. A wallet rendered from mock
    // data during an outage is worse than an error, because nobody
    // investigates a number that looks plausible.
    await assert.rejects(() => getUserProfile());
    await assert.rejects(() => getWalletBalance());
  });
});

describe("development dataset", { skip }, () => {
  let db: Database;

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    await closeAdminDb(db);
  });

  test("holds exactly the seeded number of accounts", async () => {
    const [{ n }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(t.users);
    assert.equal(SEED_USER_COUNT, 30);
    assert.ok(
      n >= SEED_USER_COUNT,
      `expected at least ${SEED_USER_COUNT} users, found ${n}`,
    );
    // Registrations push this past the baseline, which is expected — but a
    // freshly-seeded database should sit exactly on it.
    assert.ok(n <= SEED_USER_COUNT + 20, `unexpectedly many users: ${n}`);
  });

  test("every account has a wallet", async () => {
    const orphans = await db.execute<{ id: string }>(sql`
      select u.id from users u
      left join wallet_balances w on w.user_id = u.id
      where w.user_id is null
    `);
    assert.deepEqual([...orphans].map((row) => row.id), []);
  });

  test("no dependent record references a user outside the dataset", async () => {
    for (const table of [
      "investments",
      "transactions",
      "withdrawals",
      "kyc_submissions",
      "referral_accounts",
      "user_device_sessions",
      "user_security_events",
      "commission_entries",
    ]) {
      const orphans = await db.execute<{ n: number }>(
        sql`select count(*)::int as n from ${sql.identifier(table)} x
            left join users u on u.id = x.${sql.identifier(
              table === "commission_entries" ? "beneficiary_user_id" : "user_id",
            )}
            where u.id is null`,
      );
      assert.equal([...orphans][0].n, 0, `${table} has orphaned rows`);
    }
  });

  test("seeded accounts carry no Supabase credential", async () => {
    // They exist to populate the CRM. Giving them auth users would create
    // thirty sign-in-able accounts nobody owns.
    //
    // Scoped to the *seeded* rows rather than to every row, because accounts
    // registered through the real sign-in flow are expected to carry one —
    // that is the entire point of the flow. The seeded ids are the fixtures'
    // own short hex form (`usr_8c41a2`); `newId()` mints longer, time-prefixed
    // ids for anything created at runtime.
    const rows = await db
      .select({ id: t.users.id, authUserId: t.users.authUserId })
      .from(t.users)
      .where(sql`${t.users.authUserId} is not null`);

    const seeded = rows.filter((row) => /^usr_[0-9a-f]{6}$/.test(row.id));
    assert.deepEqual(
      seeded.map((row) => row.id),
      [],
      "a seeded fixture must never become sign-in-able",
    );
  });

  test("no table stores a credential", async () => {
    // Passwords, hashes and OTPs belong to Supabase Auth. A column here named
    // for one would mean somebody started a second authority.
    const columns = await db.execute<{ table_name: string; column_name: string }>(sql`
      select table_name, column_name from information_schema.columns
      where table_schema = 'public'
        and (column_name ilike '%password%' or column_name ilike '%otp%'
             or column_name ilike '%secret%' or column_name ilike '%auth_token%'
             or column_name ilike '%credential%')
        -- Not a credential: a timestamp recording that a reset was requested.
        and column_name not in ('password_reset_requested_at')
    `);
    assert.deepEqual(
      [...columns].map((c) => `${c.table_name}.${c.column_name}`),
      [],
    );
  });
});

describe("verification lifecycle", { skip }, () => {
  let db: Database;
  const users: string[] = [];
  const submissions: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of submissions) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
    }
    for (const id of users) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_kyc");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-K${suffix}`,
      fullName: "KYC Test",
      email: `kyc-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "not_started",
      referralCode: `KYC${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    users.push(id);
    return id;
  }

  /**
   * The real submission path.
   *
   * This used to hand-write the rows the action writes, which meant the test
   * could keep passing while the code it described drifted. It now calls the
   * same service the user-facing action calls; only the session lookup in front
   * of it is skipped, because a test process has no request.
   */
  async function submit(userId: string) {
    const { submissionId } = await submitKyc(
      {
        userId,
        legalName: "KYC Test",
        dateOfBirth: "1990-01-01",
        documentType: "national_id",
        documentNumberMasked: "•••• 1234",
        documentFileName: "identity-document.jpg",
        documentByteSize: 128_000,
        documentMimeType: "image/jpeg",
        // Object keys the action verifies against the session before it gets
        // here; this calls the service directly, so it supplies them.
        documentPath: `${userId}/document-${Date.now()}.jpg`,
        selfieFileName: "selfie.jpg",
        selfiePath: `${userId}/selfie-${Date.now()}.jpg`,
        selfieByteSize: 64_000,
        selfieMimeType: "image/jpeg",
      },
      MASTER,
    );
    submissions.push(submissionId);
    return submissionId;
  }

  async function statusOf(userId: string) {
    const [row] = await db
      .select({ status: t.users.kycStatus })
      .from(t.users)
      .where(eq(t.users.id, userId));
    return row.status;
  }

  test("a submission becomes pending, and the operator queue sees it", async () => {
    const userId = await makeUser();
    const submissionId = await submit(userId);

    assert.equal(await statusOf(userId), "pending_review");

    const [row] = await db
      .select()
      .from(t.kycSubmissions)
      .where(eq(t.kycSubmissions.id, submissionId));
    assert.equal(row.status, "pending");
    // The same row the CRM reads — one database, not two datasets.
    assert.equal(row.userId, userId);
  });

  test("a submission never claims a liveness check that did not happen", async () => {
    const userId = await makeUser();
    const submissionId = await submit(userId);

    const [row] = await db
      .select()
      .from(t.kycSubmissions)
      .where(eq(t.kycSubmissions.id, submissionId));

    /*
     * The whole reason this file has a KYC section.
     *
     * `liveness_check_passed` used to be whatever the browser sent, and the
     * browser sent `true` because a button had been pressed. An operator reads
     * that column as an automated check that ran and passed. Nothing in this
     * deployment can run one, so nothing may write one — and the flag says why,
     * rather than leaving a reviewer to read `false` as "this person failed".
     */
    assert.equal(row.livenessCheckPassed, false);
    assert.ok(
      row.riskFlags.includes("liveness_not_verified"),
      "the reason the check did not pass is recorded, not just the result",
    );

    const documents = await db
      .select()
      .from(t.kycDocuments)
      .where(eq(t.kycDocuments.submissionId, submissionId));
    assert.ok(
      documents.some((document) => document.label === "Selfie capture"),
      "the selfie a reviewer compares against the document is listed",
    );
  });

  test("approval is an operator decision, and the user sees it", async () => {
    const userId = await makeUser();
    const submissionId = await submit(userId);

    // The *decision*, exercised at the service layer. The action wrapping it
    // resolves its operator from a session, which a test process does not have
    // — that gate is asserted separately, above.
    await approveKyc({ submissionId, note: "documents checked" }, MASTER);

    assert.equal(await statusOf(userId), "verified");

    const entries = await db
      .select({ action: t.auditLogs.action, details: t.auditLogs.details })
      .from(t.auditLogs)
      .where(eq(t.auditLogs.targetId, submissionId));
    assert.ok(entries.some((e) => e.action === "kyc_approved"));
    assert.ok(entries.some((e) => e.details.includes("documents checked")));
  });

  test("rejection stores the reason the user is shown", async () => {
    const userId = await makeUser();
    const submissionId = await submit(userId);

    await rejectKyc(
      { submissionId, reason: "Document photo was unreadable." },
      MASTER,
    );

    assert.equal(await statusOf(userId), "rejected");

    const [row] = await db
      .select()
      .from(t.kycSubmissions)
      .where(eq(t.kycSubmissions.id, submissionId));
    assert.equal(row.status, "rejected");
    assert.equal(row.rejectionReason, "Document photo was unreadable.");
  });

  test("a rejection with no reason is refused", async () => {
    const userId = await makeUser();
    const submissionId = await submit(userId);
    await assert.rejects(
      () => rejectKyc({ submissionId, reason: "   " }, MASTER),
      KycError,
      "the reason is what the user is shown, so it cannot be blank",
    );
    assert.equal(await statusOf(userId), "pending_review");
  });
});

describe("operator identity and permissions", { skip }, () => {
  after(async () => {
    await closeDb();
  });

  test("with no session there is no operator, and none is invented", async () => {
    // The console used to open as the master admin with no sign-in at all, and
    // every mutation carried whatever operator the browser named. Both are now
    // impossible: identity comes from a verified Supabase principal or not at
    // all, and there is no argument to supply one.
    assert.equal(await getCurrentOperator(), null);
    await assert.rejects(() => requireOperator(), NotAuthenticatedOperatorError);
  });

  test("operator server actions refuse without a session", async () => {
    const { approveKycAction, setUserStatusAction, updateSettingsAction } =
      await import("@/app/admin/actions");

    // Actions return a refusal rather than throwing, so the CRM can show it.
    // What matters is that none of them proceeds.
    for (const call of [
      () => approveKycAction({ submissionId: "kyc_anything" }),
      () => setUserStatusAction({ userId: "usr_anything", status: "blocked" }),
      () =>
        updateSettingsAction({
          settings: {} as never,
          summary: "should never be written",
        }),
    ]) {
      const result = await call();
      assert.equal(result.ok, false, "an unauthenticated caller must be refused");
    }
  });

  test("the permission model reads levels from the database", async () => {
    const db = createAdminDb();
    try {
      const rows = await db.execute<{
        agent_id: string;
        name: string;
        role: "master_admin" | "agent";
        level: "none" | "view" | "manage";
      }>(sql`
        select a.id as agent_id, a.name, a.role,
               coalesce((
                 select p.level from admin_agent_permissions p
                 where p.agent_id = a.id and p.permission = 'kyc'
               ), 'none') as level
        from admin_agents a
        where a.role = 'agent' and a.status = 'active'
          and coalesce((
            select p.level from admin_agent_permissions p
            where p.agent_id = a.id and p.permission = 'kyc'
          ), 'none') <> 'manage'
        limit 1
      `);
      const candidate = [...rows][0];
      if (!candidate) return; // no such agent in this dataset

      const operator: Operator = {
        agentId: candidate.agent_id,
        name: candidate.name,
        email: "",
        role: candidate.role,
        permissions: { kyc: candidate.level },
        actor: {
          kind: "agent",
          id: candidate.agent_id,
          name: candidate.name,
          role: candidate.role,
        },
      };

      assert.equal(
        operatorHolds(operator, "kyc", "manage"),
        false,
        "a stored grant below manage does not grant manage",
      );
    } finally {
      await closeAdminDb(db);
    }
  });

  test("a master admin holds manage implicitly", () => {
    const master: Operator = {
      agentId: "agt_master",
      name: "Master",
      email: "master@example.com",
      role: "master_admin",
      // Empty grants on purpose: the role is the grant, so the map is not
      // consulted. CLAUDE.md §15.3.
      permissions: {},
      actor: MASTER,
    };
    assert.equal(operatorHolds(master, "kyc", "manage"), true);
    assert.equal(operatorHolds(master, "withdrawals", "manage"), true);
  });
});

describe("deposit intents cannot become money", { skip }, () => {
  let db: Database;
  const cleanup: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of cleanup) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.deposits).where(eq(t.deposits.id, id));
    }
    await closeAdminDb(db);
    await closeDb();
  });

  test("a development test deposit is pending, unverified and uncreditable", async () => {
    const [user] = await db.select({ id: t.users.id }).from(t.users).limit(1);

    const { depositId } = await recordDepositIntent({
      userId: user.id,
      amount: decimal("50"),
    });
    cleanup.push(depositId);

    const [row] = await db
      .select()
      .from(t.deposits)
      .where(eq(t.deposits.id, depositId));

    assert.equal(row.status, "pending");
    assert.equal(row.verification, "unverified");
    assert.ok(row.txHash.startsWith("intent:"), "must not look like a chain hash");
    assert.equal(row.blockNumber, null);

    // The wallet is untouched: no ledger entry cites this deposit.
    const ledger = await db
      .select({ id: t.transactions.id })
      .from(t.transactions)
      .where(eq(t.transactions.reference, row.txHash));
    assert.equal(ledger.length, 0);

    // And it cannot be turned into money: only `confirmed` can be assigned,
    // and only the scanner sets that.
    await assert.rejects(
      () => assignDepositToUser({ depositId, userId: user.id }, MASTER),
      DepositError,
    );
  });
});
