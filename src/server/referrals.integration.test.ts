import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { desc, eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";

import { createInvestment } from "./services/investments-write.service";
import { releaseCommission } from "./services/referrals-write.service";
import { isRedeemableReferralCode } from "./services/referrals.service";
import { creditWallet } from "./services/wallet.service";
import { newId, type Actor } from "./write";

/**
 * The referral programme, end to end, against the real database.
 *
 * WHAT THIS IS PROTECTING
 * -----------------------
 * The chain the product describes to the user is: someone follows a link, signs
 * up, invests, and the person who introduced them earns commission. Every link
 * of that except the last was implemented and the last one was not, so the
 * screen showed a correct picture of a programme that never moved. These tests
 * exist so it cannot quietly stop moving again.
 *
 * The assertions are on *properties*, never on absolute row counts — a real
 * registration through the sign-in flow must not read as a regression
 * (CLAUDE.md §16.7).
 *
 * Skipped with no database: writes have no fallback, by design.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_ref_test",
  name: "Referral Test Operator",
  role: "master_admin",
};

describe("referral commission", { skip }, () => {
  let db: Database;
  let planId: string;
  const createdUsers: string[] = [];

  before(async () => {
    db = createAdminDb();
    // Any open plan will do; the test asserts the commission against whatever
    // this plan's terms are rather than assuming a particular one exists.
    const [plan] = await db
      .select({ id: t.plans.id, min: t.plans.minInvestment })
      .from(t.plans)
      .where(eq(t.plans.status, "open"))
      .limit(1);
    assert.ok(plan, "the catalogue has at least one active plan");
    planId = plan.id;
  });

  after(async () => {
    for (const id of createdUsers) {
      // Commission entries and referral rows cascade from the accounts.
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser(vipLevel: "vip1" | "vip2" | "vip3" = "vip1") {
    const id = newId("usr_reftest");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-R${suffix}`,
      fullName: `Referral Test ${suffix}`,
      email: `referral-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      vipLevel,
      referralCode: `RT${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    return id;
  }

  /** The edge account creation writes. Reproduced here without the auth flow. */
  async function link(referrerId: string, referredId: string) {
    await db.insert(t.referrals).values({
      id: newId("ref_test"),
      referrerUserId: referrerId,
      referredUserId: referredId,
      name: "Referral Test",
      maskedEmail: "r••••t@example.invalid",
      joinedAt: new Date(),
      status: "registered",
      tier: 1,
    });
  }

  async function commissionFor(userId: string) {
    return db
      .select()
      .from(t.commissionEntries)
      .where(eq(t.commissionEntries.beneficiaryUserId, userId))
      .orderBy(desc(t.commissionEntries.createdAt));
  }

  test("an allocation pays the direct referrer at their VIP tier-1 rate", async () => {
    const referrer = await makeUser("vip2");
    const investor = await makeUser();
    await link(referrer, investor);

    await creditWallet(
      { userId: investor, amount: decimal("1000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    await createInvestment(
      { userId: investor, planId, amount: decimal("500") },
      OPERATOR,
    );

    const [rate] = await db
      .select({ tier1: t.vipLevels.tier1CommissionPercent })
      .from(t.vipLevels)
      .where(eq(t.vipLevels.id, "vip2"));

    const entries = await commissionFor(referrer);
    assert.equal(entries.length, 1, "exactly one commission entry");
    assert.equal(entries[0].tier, 1);
    assert.equal(entries[0].sourceUserId, investor);
    // The rate is read from the same table the UI quotes, not restated here.
    assert.equal(entries[0].amountUsdt, 500 * (rate.tier1 / 100));
    assert.equal(
      entries[0].status,
      "pending",
      "commission accrues pending — nothing settles it yet",
    );
  });

  test("the allocation moves the referrer's standing and never their balance", async () => {
    const referrer = await makeUser("vip1");
    const investor = await makeUser();
    await link(referrer, investor);

    await creditWallet(
      { userId: investor, amount: decimal("1000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    await createInvestment(
      { userId: investor, planId, amount: decimal("400") },
      OPERATOR,
    );

    const [account] = await db
      .select()
      .from(t.referralAccounts)
      .where(eq(t.referralAccounts.userId, referrer));

    assert.ok(account, "an aggregate row exists for the referrer");
    assert.equal(account.activeReferrals, 1, "the referral is now active");
    assert.equal(account.teamVolumeUsdt, 400, "team volume follows the allocation");
    assert.ok(
      account.commissionPendingUsdt > 0,
      "the commission is pending, not zero",
    );

    const [edge] = await db
      .select()
      .from(t.referrals)
      .where(eq(t.referrals.referredUserId, investor));
    assert.equal(edge.status, "active", "registered → active on first allocation");
    assert.equal(edge.investedAmount, 400);

    /*
     * The property that matters most in this file.
     *
     * Commission accrues; it is not paid. There is no settlement process
     * (CLAUDE.md §16.5), so crediting here would be paying out on a rule
     * nobody defined. If that ever changes it must change deliberately, and
     * this assertion is what makes it impossible to change by accident.
     */
    const [wallet] = await db
      .select()
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, referrer));
    assert.equal(wallet.available, 0, "no money reached the referrer's balance");

    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, referrer));
    assert.equal(ledger.length, 0, "and no ledger entry was written for them");
  });

  test("a second allocation adds volume but not a second active referral", async () => {
    const referrer = await makeUser();
    const investor = await makeUser();
    await link(referrer, investor);

    await creditWallet(
      { userId: investor, amount: decimal("2000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    await createInvestment({ userId: investor, planId, amount: decimal("300") }, OPERATOR);
    await createInvestment({ userId: investor, planId, amount: decimal("200") }, OPERATOR);

    const [account] = await db
      .select()
      .from(t.referralAccounts)
      .where(eq(t.referralAccounts.userId, referrer));

    assert.equal(
      account.activeReferrals,
      1,
      "one person who invested twice is still one active referral",
    );
    assert.equal(account.teamVolumeUsdt, 500, "both allocations count as volume");
    assert.equal((await commissionFor(referrer)).length, 2, "one entry per allocation");
  });

  test("the second tier is paid, and there is no third", async () => {
    const top = await makeUser("vip3");
    const middle = await makeUser("vip3");
    const investor = await makeUser();
    await link(top, middle);
    await link(middle, investor);

    await creditWallet(
      { userId: investor, amount: decimal("1000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    await createInvestment({ userId: investor, planId, amount: decimal("600") }, OPERATOR);

    const [rate] = await db
      .select({
        tier1: t.vipLevels.tier1CommissionPercent,
        tier2: t.vipLevels.tier2CommissionPercent,
      })
      .from(t.vipLevels)
      .where(eq(t.vipLevels.id, "vip3"));

    const direct = await commissionFor(middle);
    assert.equal(direct.length, 1);
    assert.equal(direct[0].tier, 1);
    assert.equal(direct[0].amountUsdt, 600 * (rate.tier1 / 100));

    const indirect = await commissionFor(top);
    assert.equal(indirect.length, 1, "the grandparent is paid once");
    assert.equal(indirect[0].tier, 2);
    assert.equal(indirect[0].amountUsdt, 600 * (rate.tier2 / 100));

    // Only the direct edge carries a `referrals` row for this investor, so the
    // second-tier beneficiary's own edge must be untouched by the allocation.
    const [topEdge] = await db
      .select()
      .from(t.referrals)
      .where(eq(t.referrals.referredUserId, middle));
    assert.equal(topEdge.investedAmount, 0, "the grandparent's edge is not the investor's");
  });

  test("a referrer is promoted once they meet both VIP requirements", async () => {
    const [levels] = await Promise.all([
      db
        .select({
          id: t.vipLevels.id,
          referrals: t.vipLevels.requiredActiveReferrals,
          volume: t.vipLevels.requiredTeamVolumeUsdt,
          sortOrder: t.vipLevels.sortOrder,
        })
        .from(t.vipLevels)
        .orderBy(t.vipLevels.sortOrder),
    ]);
    const second = levels[1];
    assert.ok(second, "there is a level above the entry one");

    const referrer = await makeUser("vip1");

    /*
     * Enough referrals and enough volume to clear the second level's *both*
     * requirements. The thresholds are read from the table rather than
     * restated, so changing the configuration changes the test with it.
     */
    const investors: string[] = [];
    for (let i = 0; i < second.referrals; i += 1) {
      const investor = await makeUser();
      await link(referrer, investor);
      investors.push(investor);
    }

    const each = Math.ceil(second.volume / Math.max(second.referrals, 1));
    for (const investor of investors) {
      await creditWallet(
        {
          userId: investor,
          amount: decimal(String(each * 2)),
          description: "Test float",
          type: "deposit",
        },
        OPERATOR,
      );
      await createInvestment(
        { userId: investor, planId, amount: decimal(String(each)) },
        OPERATOR,
      );
    }

    const [after] = await db
      .select({ vipLevel: t.users.vipLevel })
      .from(t.users)
      .where(eq(t.users.id, referrer));

    assert.notEqual(
      after.vipLevel,
      "vip1",
      "meeting both thresholds promotes the referrer",
    );
  });

  test("releasing a commission credits the wallet exactly once", async () => {
    const referrer = await makeUser();
    const investor = await makeUser();
    await link(referrer, investor);

    await creditWallet(
      { userId: investor, amount: decimal("1000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    await createInvestment({ userId: investor, planId, amount: decimal("500") }, OPERATOR);

    const [entry] = await commissionFor(referrer);
    assert.equal(entry.status, "pending");

    const { amount } = await releaseCommission(
      { commissionEntryId: entry.id, note: "Test release" },
      OPERATOR,
    );

    const [wallet] = await db
      .select()
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, referrer));
    assert.equal(
      wallet.available,
      Number(amount),
      "the released amount reached the balance",
    );

    // The ledger explains the balance — the property `applyLedgerEntry` exists
    // to guarantee (CLAUDE.md §17.3).
    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, referrer));
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].type, "referral");
    assert.equal(ledger[0].reference, entry.id);

    const [account] = await db
      .select()
      .from(t.referralAccounts)
      .where(eq(t.referralAccounts.userId, referrer));
    assert.equal(account.commissionEarnedUsdt, Number(amount));
    assert.equal(account.commissionPendingUsdt, 0);

    // Guarded on the status in the UPDATE's own WHERE, so a second attempt is
    // refused rather than paying twice.
    await assert.rejects(
      () => releaseCommission({ commissionEntryId: entry.id }, OPERATOR),
      /already been paid/,
    );

    const ledgerAfter = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.userId, referrer));
    assert.equal(ledgerAfter.length, 1, "still exactly one payment");
  });

  test("the programme switch in platform settings is honoured", async () => {
    const [row] = await db
      .select({ referrals: t.platformSettings.referrals })
      .from(t.platformSettings)
      .where(eq(t.platformSettings.id, "default"));
    assert.ok(row, "a settings row exists");
    const original = row.referrals;

    const referrer = await makeUser();
    const investor = await makeUser();
    await link(referrer, investor);
    await creditWallet(
      { userId: investor, amount: decimal("1000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );

    try {
      await db
        .update(t.platformSettings)
        .set({ referrals: { ...original, programmeEnabled: false } })
        .where(eq(t.platformSettings.id, "default"));

      await createInvestment(
        { userId: investor, planId, amount: decimal("300") },
        OPERATOR,
      );

      assert.equal(
        (await commissionFor(referrer)).length,
        0,
        "no commission accrues while the programme is switched off",
      );
    } finally {
      // Restored whatever happens: this row is shared platform configuration
      // and a failed assertion must not leave the programme disabled.
      await db
        .update(t.platformSettings)
        .set({ referrals: original })
        .where(eq(t.platformSettings.id, "default"));
    }
  });

  test("an invite code is validated against a real, active account", async () => {
    const referrer = await makeUser();
    const [row] = await db
      .select({ code: t.users.referralCode })
      .from(t.users)
      .where(eq(t.users.id, referrer));

    assert.equal(
      await isRedeemableReferralCode(row.code),
      true,
      "a live code is redeemable",
    );
    assert.equal(
      await isRedeemableReferralCode("NOSUCHCODE"),
      false,
      "a well-formed code naming nobody is refused — it used to be stored and " +
        "then silently dropped at account creation",
    );

    /*
     * A blocked referrer cannot accrue a team.
     *
     * They are shut out of the product, so an attribution made to them is a
     * commission relationship nobody can act on.
     */
    await db
      .update(t.users)
      .set({ status: "blocked" })
      .where(eq(t.users.id, referrer));
    assert.equal(await isRedeemableReferralCode(row.code), false);
  });

  test("an allocation by an unreferred account pays nobody", async () => {
    const investor = await makeUser();
    await creditWallet(
      { userId: investor, amount: decimal("1000"), description: "Test float", type: "deposit" },
      OPERATOR,
    );
    await createInvestment({ userId: investor, planId, amount: decimal("250") }, OPERATOR);

    const entries = await db
      .select()
      .from(t.commissionEntries)
      .where(eq(t.commissionEntries.sourceUserId, investor));
    assert.equal(entries.length, 0);
  });
});
