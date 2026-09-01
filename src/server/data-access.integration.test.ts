import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { adminCommissionLedger, adminInvestments } from "@/data/admin";
import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { SEED_USER_COUNT } from "@/db/seed";

import { listAdminPlans, listPublicPlans } from "./repositories/catalogue.repository";
import { listInvestmentsForUser } from "./repositories/investments.repository";
import { listKycSubmissions } from "./repositories/kyc.repository";
import {
  listAdminDeposits,
  listAdminWithdrawals,
  listTransactionsForUser,
} from "./repositories/ledger.repository";
import { listAdminAgents, listAuditLog } from "./repositories/admin.repository";
import { findUserProfile, findWalletBalance, listAdminUsers } from "./repositories/users.repository";

import {
  getAdminCommissionLedger,
  getAdminInvestments,
  getPlatformSettings,
} from "./services/admin.service";
import { getReferralSummary } from "./services/referrals.service";

/**
 * The repositories and services, against the real database.
 *
 * These assert on the seeded records rather than on shapes alone. Shapes are
 * already guaranteed by the types; what these catch is a query that joins
 * wrongly, a mapper that drops a field, or a migration applied to a database
 * that was never seeded — none of which the type system can see.
 *
 * Skipped when no database is configured, because the application is designed
 * to run without one and `npm test` must stay green on a fresh clone.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

/**
 * The seeded demo account, named directly.
 *
 * It used to come from `getCurrentUserId()`, which returned a fixed demo user.
 * That function now resolves the *signed-in* account, and a test has no
 * session — so the fixture states which account it means instead of asking a
 * question that no longer has that answer.
 */
const DEMO = "usr_8c41a2";

describe("repositories", { skip }, () => {
  let db: Database;

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    await closeAdminDb(db);
  });

  test("reads the demo account's profile with its verification steps", async () => {
    const profile = await findUserProfile(db, DEMO);
    assert.ok(profile);
    assert.equal(profile.fullName, "Aarav Sharma");
    assert.equal(profile.displayId, "NT-4820193");
    assert.equal(profile.kycStatus, "not_started");
    assert.equal(profile.vipLevel, "vip2");
    assert.equal(profile.referralCode, "AARAV4820");
    // Ordered by position, and the first step is the one in progress.
    assert.deepEqual(
      profile.kycSteps.map((step) => step.id),
      ["personal", "document", "selfie", "review"],
    );
    assert.equal(profile.kycSteps[0].status, "current");
    // ISO strings, not Date objects — the domain contract the components read.
    assert.equal(typeof profile.memberSince, "string");
  });

  test("reads the wallet, and the numbers are numbers", async () => {
    const wallet = await findWalletBalance(db, DEMO);
    assert.ok(wallet);
    assert.equal(wallet.available, 1250);
    assert.equal(wallet.lockedInInvestments, 3900);
    assert.equal(wallet.totalProfit, 842.35);
    // `numeric` comes back from the driver as a string unless mapped; a
    // regression here would silently turn arithmetic into concatenation.
    assert.equal(typeof wallet.available, "number");
  });

  test("the wallet reconciles against the account's active allocations", async () => {
    const wallet = await findWalletBalance(db, DEMO);
    const investments = await listInvestmentsForUser(db, DEMO);
    const locked = investments
      .filter((investment) => investment.status === "active")
      .reduce((sum, investment) => sum + investment.amount, 0);
    assert.equal(locked, wallet?.lockedInInvestments);
  });

  test("translates the stored investment status for the user application", async () => {
    const investments = await listInvestmentsForUser(db, DEMO);
    assert.equal(investments.length, 5);
    // Stored as `matured`; the user application has always called it completed.
    // The domain type has no `matured` member at all, so this checks the value
    // that actually arrives rather than the one the type promises.
    const statuses = investments.map((investment) => String(investment.status));
    assert.ok(statuses.includes("completed"));
    assert.ok(!statuses.includes("matured"));
    // Newest first.
    const dates = investments.map((investment) => investment.startDate);
    assert.deepEqual(dates, [...dates].sort().reverse());
  });

  test("reads the ledger for the account", async () => {
    const transactions = await listTransactionsForUser(db, DEMO);
    /*
     * At least the seeded entries, never exactly them.
     *
     * This asserted `=== 14` and broke the first time the settlement job
     * returned a matured allocation's principal — a correct movement that
     * writes a correct ledger row. CLAUDE.md §16.7 already forbids exact counts
     * against the live database for precisely this reason; the count was
     * incidental to what this test is for, which is that the ledger reads back
     * with the right shapes.
     */
    assert.ok(
      transactions.length >= 14,
      `expected at least the seeded ledger, got ${transactions.length}`,
    );
    assert.ok(transactions.some((transaction) => transaction.type === "deposit"));
    assert.ok(transactions.some((transaction) => transaction.amount < 0));
    // Optional columns arrive as undefined, never null.
    const deposit = transactions.find((transaction) => transaction.confirmations);
    assert.ok(deposit?.confirmations);
    assert.equal(typeof deposit.confirmations.required, "number");
  });

  test("excludes disabled plans from the public catalogue", async () => {
    const [publicPlans, adminPlans] = await Promise.all([
      listPublicPlans(db),
      listAdminPlans(db),
    ]);
    assert.equal(adminPlans.length, 5);
    assert.equal(publicPlans.length, 5);
    assert.ok(
      publicPlans.every((plan) => String(plan.status) !== "disabled"),
      "a disabled plan must not reach the public catalogue",
    );
    // The range survives the round trip through two numeric columns.
    const starter = publicPlans.find((plan) => plan.slug === "starter");
    assert.deepEqual(starter?.estimatedReturnRange, [2.8, 4.2]);
    assert.ok(Array.isArray(starter?.howItWorks) && starter.howItWorks.length > 0);
  });

  test("joins the account onto every CRM row", async () => {
    const [users, deposits, withdrawals] = await Promise.all([
      listAdminUsers(db),
      listAdminDeposits(db),
      listAdminWithdrawals(db),
    ]);
    // At least the development dataset — see SEED_USER_COUNT. Not an exact
    // count: accounts registered through the real sign-in flow push it past
    // thirty, which is expected and correct. The seeded dataset is a baseline,
    // not a limit, and an exact assertion here would make a successful sign-up
    // look like a regression.
    assert.ok(
      users.length >= SEED_USER_COUNT,
      `expected at least the seeded accounts, got ${users.length}`,
    );
    // Not an exact count: the scanner writes real chain deposits into this
    // table, so a fixed number would fail the moment a testnet transfer is
    // detected. What this test is about is the join, asserted below.
    assert.ok(deposits.length >= 20, `expected the seeded rows, got ${deposits.length}`);
    assert.ok(
      withdrawals.length >= 14,
      `expected the seeded rows, got ${withdrawals.length}`,
    );

    // Every row carries a label, attributed or not — an inner join would have
    // dropped the unassigned chain deposits entirely.
    assert.ok(deposits.every((deposit) => deposit.userName.length > 0));
    assert.ok(
      deposits
        .filter((deposit) => deposit.userId === null)
        .every((deposit) => deposit.userName === "Unassigned"),
    );
    assert.ok(withdrawals.every((withdrawal) => withdrawal.userName.length > 0));

    // Totals come from the wallet table via a left join.
    const demo = users.find((user) => user.id === DEMO);
    assert.equal(demo?.totals.availableUsdt, 1250);
    assert.equal(demo?.restrictions.accountFrozen, false);
  });

  test("groups KYC documents and notes onto their submissions", async () => {
    const submissions = await listKycSubmissions(db);

    // A real user submitting verification adds a row here, so the counts move.
    // What this test is about is the grouping, and the property that catches
    // the bug it exists to catch — a join multiplying each submission by its
    // documents — is that no document or note appears twice.
    assert.ok(
      submissions.length >= 14,
      `expected the seeded cases, got ${submissions.length}`,
    );

    const documentIds = submissions.flatMap((s) => s.documents.map((d) => d.id));
    const noteIds = submissions.flatMap((s) => s.notes.map((n) => n.id));
    assert.equal(
      new Set(documentIds).size,
      documentIds.length,
      "documents should not be multiplied by a join",
    );
    assert.equal(new Set(noteIds).size, noteIds.length);

    assert.ok(submissions.every((s) => s.userName.length > 0));
    assert.ok(submissions.every((s) => Array.isArray(s.riskFlags)));
  });

  test("rebuilds each agent's permission map from its rows", async () => {
    const agents = await listAdminAgents(db);
    assert.equal(agents.length, 9);
    for (const agent of agents) {
      // All 13 governable areas present, defaulting to none where ungranted.
      assert.equal(Object.keys(agent.permissions).length, 13);
      assert.ok(
        Object.values(agent.permissions).every((level) =>
          ["none", "view", "manage"].includes(level),
        ),
      );
    }
    const master = agents.find((agent) => agent.role === "master_admin");
    assert.ok(master, "there should be a master admin");
  });

  test("reads the audit trail newest first", async () => {
    const entries = await listAuditLog(db);
    // Not an exact count: the audit log is append-only and every write in the
    // application adds to it, so pinning a number here would make this test
    // fail whenever something else legitimately recorded an action. The seed
    // count is asserted in the seed's own test, where it is the subject.
    assert.ok(entries.length >= 20, "the seeded entries should still be there");
    const dates = entries.map((entry) => entry.createdAt);
    assert.deepEqual(dates, [...dates].sort().reverse());
    // A null target must survive as null, not as a half-built object.
    assert.ok(entries.every((entry) => entry.target === null || entry.target.id));
  });
});

describe("services read the database, not the seed modules", { skip }, () => {
  after(async () => {
    await closeDb();
  });

  test("the CRM's allocations are the seeded rows, not @/data/admin", async () => {
    const live = await getAdminInvestments();
    // Both are 29 now that the dataset is trimmed to thirty accounts, so the
    // count alone no longer distinguishes database from fallback. The stronger
    // check is below: an allocation belonging to an account the dataset drops
    // exists in the mock module and must NOT come back from the database.
    assert.equal(adminInvestments.length, 29);
    assert.equal(live.length, 29);

    const liveIds = new Set(live.map((investment) => investment.id));
    const droppedByTrim = adminInvestments.filter(
      (investment) => !liveIds.has(investment.id),
    );
    assert.ok(
      droppedByTrim.length > 0,
      "the trim should have removed some mock allocations",
    );
    for (const investment of droppedByTrim) {
      assert.ok(
        !liveIds.has(investment.id),
        "a fallback would have returned the mock module verbatim",
      );
    }
  });

  test("the commission ledger is the seeded ledger", async () => {
    const live = await getAdminCommissionLedger();
    assert.equal(adminCommissionLedger.length, 17);
    assert.equal(live.length, 21);
  });

  test("computes referral standing against the stored VIP thresholds", async () => {
    const summary = await getReferralSummary(DEMO);
    assert.equal(summary.currentLevel, "vip2");
    assert.equal(summary.activeReferrals, 8);
    assert.equal(summary.totalEarnings, 214.6);
    assert.equal(summary.totalReferrals, 12);
    // Derived, never stored: a percentage toward the next tier.
    assert.ok(summary.nextLevelProgress !== null);
    assert.ok(summary.nextLevelProgress >= 0 && summary.nextLevelProgress <= 100);
  });

  test("reads platform settings from the single configuration row", async () => {
    const settings = await getPlatformSettings();
    assert.equal(settings.platform.name, "Nanotron");
    assert.equal(typeof settings.currency.displayRate, "number");
    assert.equal(typeof settings.withdrawals.minimumUsdt, "number");
    assert.equal(settings.referrals.maxTiers, 2);
  });
});
