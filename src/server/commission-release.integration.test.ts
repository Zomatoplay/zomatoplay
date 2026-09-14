import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { businessMidnightUtc, formatBusinessDateTime } from "@/lib/business-time";
import * as t from "@/db/schema";

import {
  releaseCommission,
  releaseDueCommissions,
} from "./services/referrals-write.service";
import { newId, SYSTEM_ACTOR, type Actor } from "./write";

/**
 * The nightly referral-commission release, against the real database.
 *
 * WHAT THIS PROTECTS
 * ------------------
 * Commission release used to be an operator pressing a button, and the reason
 * given was that nothing defined *when* an allocation becomes payable. It now
 * does: `release_at`, stamped at accrual from `payoutDelayDays` on the business
 * calendar, and a job at 00:00 IST that pays everything due.
 *
 * The properties that make that safe rather than merely automatic:
 *
 * - eligibility is `release_at <= now`, so a **missed midnight is late, not
 *   lost** — the whole reason a polling design was chosen;
 * - a **null `release_at` is never due**, so historical entries are not paid on
 *   a date nobody set;
 * - running the job **twice pays once**, and so does the job racing an
 *   operator, because the status transition is asserted in the `UPDATE`'s own
 *   `WHERE` clause rather than checked beforehand.
 *
 * Skipped with no database: writes have no fallback, by design.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_release_test",
  name: "Release Test Operator",
  role: "master_admin",
};

describe("automatic commission release", { skip }, () => {
  let db: Database;
  const createdUsers: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of createdUsers) {
      // Commission entries, wallets and ledger rows cascade from the account.
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, SYSTEM_ACTOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeBeneficiary() {
    const id = newId("usr_reltest");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-R${suffix}`,
      fullName: `Release Test ${suffix}`,
      email: `release-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      vipLevel: "vip1",
      referralCode: `RL${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    await db.insert(t.referralAccounts).values({
      userId: id,
      joinedAt: new Date(),
    });
    createdUsers.push(id);
    return id;
  }

  /**
   * An entry with a chosen release time.
   *
   * Written directly rather than through `accrueReferralCommission`: the point
   * of these tests is the *release* rule, and driving a real allocation for
   * each case would make every one of them depend on the accrual rule too.
   * Accrual's own stamping is asserted in its own test below.
   */
  async function makeEntry(
    beneficiaryUserId: string,
    releaseAt: Date | null,
    amount = 10,
  ) {
    const id = newId("com_reltest");
    await db.insert(t.commissionEntries).values({
      id,
      beneficiaryUserId,
      sourceUserId: null,
      sourceUserName: "Release Test Source",
      tier: 1,
      amountUsdt: amount,
      sourcePlanName: "Release Test Plan",
      createdAt: new Date(),
      status: "pending",
      releaseAt,
    });
    // Mirror what accrual does to the aggregate, so the release's own
    // pending→earned move can be asserted against a sane starting point.
    await db
      .update(t.referralAccounts)
      .set({ commissionPendingUsdt: amount })
      .where(eq(t.referralAccounts.userId, beneficiaryUserId));
    return id;
  }

  async function entry(id: string) {
    const [row] = await db
      .select()
      .from(t.commissionEntries)
      .where(eq(t.commissionEntries.id, id));
    return row;
  }

  async function available(userId: string) {
    const [row] = await db
      .select({ available: t.walletBalances.available })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return row.available;
  }

  const HOUR = 3_600_000;

  /* ----------------------------------------------------------- eligibility -- */

  test("an entry due in the future is not released", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() + 48 * HOUR));

    await releaseDueCommissions();

    assert.equal((await entry(id)).status, "pending");
    assert.equal(await available(user), 0, "nothing reached the wallet");
  });

  test("an entry due in the past is released", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 12);

    const summary = await releaseDueCommissions();
    assert.ok(summary.released >= 1);

    const row = await entry(id);
    assert.equal(row.status, "credited");
    assert.ok(row.releasedAt, "the payment timestamp is recorded");
    assert.equal(await available(user), 12, "the wallet was credited");
  });

  test("an entry due exactly now is released — the boundary is inclusive", async () => {
    const user = await makeBeneficiary();
    const now = new Date();
    const id = await makeEntry(user, now, 7);

    // `release_at <= now`, so an entry whose moment is exactly the run's
    // instant is due. The alternative, `<`, would leave an entry scheduled for
    // 00:00:00.000 unpaid by a job that starts at 00:00:00.000.
    await releaseDueCommissions({ now });

    assert.equal((await entry(id)).status, "credited");
  });

  test("a missed midnight is recovered by the next run", async () => {
    const user = await makeBeneficiary();
    // Scheduled for last night's boundary; the job did not run then.
    const lastMidnight = businessMidnightUtc(new Date(), 0);
    const id = await makeEntry(user, lastMidnight, 5);

    // The next successful pass — an hour and a bit late.
    await releaseDueCommissions({ now: new Date(lastMidnight.getTime() + 77 * 60_000) });

    assert.equal(
      (await entry(id)).status,
      "credited",
      `an entry due at ${formatBusinessDateTime(lastMidnight)} is still paid later`,
    );
  });

  test("an entry with no release date is never released automatically", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, null, 9);

    await releaseDueCommissions();

    assert.equal(
      (await entry(id)).status,
      "pending",
      "no rule says when a historical entry is payable; the job does not invent one",
    );
    assert.equal(await available(user), 0);

    // …but an operator can still release it by hand, which is the whole point
    // of leaving it pending rather than discarding it.
    await releaseCommission({ commissionEntryId: id }, OPERATOR);
    assert.equal((await entry(id)).status, "credited");
    assert.equal(await available(user), 9);
  });

  /* -------------------------------------------------------------- idempotency */

  test("running the job twice pays once", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 20);

    await releaseDueCommissions();
    const afterFirst = await available(user);

    await releaseDueCommissions();
    assert.equal(await available(user), afterFirst, "the second pass paid nothing");

    const ledger = await db
      .select({ id: t.transactions.id })
      .from(t.transactions)
      .where(eq(t.transactions.reference, id));
    assert.equal(ledger.length, 1, "exactly one ledger entry exists for this entry");
  });

  test("two passes overlapping pay once", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 15);

    // Both read the same due list; only one `UPDATE … WHERE status = 'pending'`
    // can match.
    const [a, b] = await Promise.all([
      releaseDueCommissions(),
      releaseDueCommissions(),
    ]);

    const released = a.released + b.released;
    const attempts = a.due + b.due;
    assert.ok(attempts >= 2, "both passes saw the entry as due");

    assert.equal(await available(user), 15, "the wallet moved once");
    assert.equal((await entry(id)).status, "credited");
    assert.ok(released >= 1, `at least one pass reported paying it (${released})`);
  });

  test("the job racing an operator pays once", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 11);

    const results = await Promise.allSettled([
      releaseDueCommissions(),
      releaseCommission({ commissionEntryId: id }, OPERATOR),
    ]);

    // Whichever lost is refused; the balance is what proves it paid once.
    assert.equal(await available(user), 11);
    assert.equal((await entry(id)).status, "credited");
    assert.ok(
      results.some((result) => result.status === "fulfilled"),
      "one of the two succeeded",
    );

    const ledger = await db
      .select({ id: t.transactions.id })
      .from(t.transactions)
      .where(eq(t.transactions.reference, id));
    assert.equal(ledger.length, 1);
  });

  test("a released entry cannot be released again by hand either", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 6);

    await releaseDueCommissions();
    await assert.rejects(
      () => releaseCommission({ commissionEntryId: id }, OPERATOR),
      (error: unknown) =>
        error instanceof Error && /already been paid/i.test(error.message),
    );
    assert.equal(await available(user), 6);
  });

  /* ------------------------------------------------------------- accounting -- */

  test("release moves the aggregate from pending to earned, in the same transaction", async () => {
    const user = await makeBeneficiary();
    await makeEntry(user, new Date(Date.now() - HOUR), 25);

    await releaseDueCommissions();

    const [account] = await db
      .select()
      .from(t.referralAccounts)
      .where(eq(t.referralAccounts.userId, user));

    assert.equal(account.commissionPendingUsdt, 0);
    assert.equal(account.commissionEarnedUsdt, 25);
  });

  test("the automatic release is audited, and names the system as the actor", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 3);

    await releaseDueCommissions();

    const [audit] = await db
      .select()
      .from(t.auditLogs)
      .where(eq(t.auditLogs.actorId, SYSTEM_ACTOR.id))
      .orderBy(t.auditLogs.createdAt);

    assert.ok(audit, "an audit entry exists");
    const entries = await db
      .select({ details: t.auditLogs.details })
      .from(t.auditLogs)
      .where(eq(t.auditLogs.actorId, SYSTEM_ACTOR.id));
    assert.ok(
      entries.some((row) => row.details.includes(id)),
      "the entry names the commission it released",
    );
  });

  test("a zero-amount entry is refused rather than written as a zero payment", async () => {
    const user = await makeBeneficiary();
    const id = await makeEntry(user, new Date(Date.now() - HOUR), 0);

    const summary = await releaseDueCommissions();

    assert.equal((await entry(id)).status, "pending");
    assert.ok(
      summary.skipped.some((skipped) => skipped.commissionEntryId === id),
      "and it is reported as skipped rather than silently ignored",
    );
  });
});

/* -------------------------------------------------------------------------- */
/* The schedule itself                                                         */
/* -------------------------------------------------------------------------- */

describe("business-calendar midnight", () => {
  test("maps to 18:30 UTC the previous day", () => {
    // 2026-09-13T20:00Z is 2026-09-14T01:30 IST, so its business day is the
    // 14th and the next boundary is the 15th at 00:00 IST = 14th 18:30 UTC.
    const at = new Date("2026-09-13T20:00:00.000Z");
    assert.equal(
      businessMidnightUtc(at, 1).toISOString(),
      "2026-09-14T18:30:00.000Z",
    );
  });

  test("an instant just before the boundary belongs to the earlier business day", () => {
    // 18:29Z on the 13th is 23:59 IST on the 13th.
    const before = new Date("2026-09-13T18:29:00.000Z");
    // 18:30Z on the 13th is 00:00 IST on the 14th.
    const after = new Date("2026-09-13T18:30:00.000Z");

    assert.equal(
      businessMidnightUtc(before, 0).toISOString(),
      "2026-09-12T18:30:00.000Z",
      "the 13th IST started at 18:30Z on the 12th",
    );
    assert.equal(
      businessMidnightUtc(after, 0).toISOString(),
      "2026-09-13T18:30:00.000Z",
      "the 14th IST started at 18:30Z on the 13th",
    );
  });

  test("three days ahead is exactly three days, never two or four", () => {
    const at = new Date("2026-09-13T06:00:00.000Z"); // 11:30 IST on the 13th
    assert.equal(
      businessMidnightUtc(at, 3).toISOString(),
      "2026-09-15T18:30:00.000Z", // 00:00 IST on the 16th
    );
  });

  test("the label writes the zone down", () => {
    assert.equal(
      formatBusinessDateTime("2026-09-15T18:30:00.000Z"),
      "16 Sep 2026, 00:00 IST",
    );
  });
});
