import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq, sql } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

import {
  assignDepositToUser,
  DepositError,
  ignoreDeposit,
  recordObservedDeposit,
} from "./services/deposits.service";
import { createNotification, setKycStatus } from "./services/account-write.service";
import { creditWallet, recordInvestmentEarning } from "./services/wallet.service";
import { newId, type Actor } from "./write";

/**
 * The write layer, against the real database.
 *
 * Every test here creates its own throwaway account and removes it afterwards,
 * so the suite can run repeatedly against the development database without
 * accumulating debris or depending on the seeded rows.
 *
 * Skipped when no database is configured — writes have no fallback, by design.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_test",
  name: "Test Operator",
  role: "master_admin",
};

describe("writes", { skip }, () => {
  let db: Database;
  const createdUsers: string[] = [];
  const createdDeposits: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    // Cascades clear wallets, ledger rows, investments and earnings.
    for (const id of createdUsers) {
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    // Audit entries are removed before the deposits they point at, and by
    // target rather than by actor: the scanner records detection as the system
    // actor, so deleting only this suite's operator would leave those behind
    // and slowly inflate the log every time the suite runs.
    for (const id of createdDeposits) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.deposits).where(eq(t.deposits.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser(overrides: Partial<{ kycStatus: "verified" | "not_started" }> = {}) {
    const id = newId("usr_test");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-T${suffix}`,
      fullName: "Write Test",
      email: `write-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: overrides.kycStatus ?? "verified",
      referralCode: `TEST${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    return id;
  }

  /** Reads a balance as text, so the assertion is not comparing floats. */
  async function balanceOf(userId: string) {
    const [row] = await db
      .select({
        available: sql<string>`${t.walletBalances.available}::text`,
        totalDeposited: sql<string>`${t.walletBalances.totalDeposited}::text`,
        totalProfit: sql<string>`${t.walletBalances.totalProfit}::text`,
      })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return row;
  }

  async function ledgerFor(userId: string) {
    return db
      .select({
        id: t.transactions.id,
        type: t.transactions.type,
        amount: sql<string>`${t.transactions.amount}::text`,
        reference: t.transactions.reference,
      })
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
  }

  /* ---------------------------------------------------------------- ledger */

  test("a credit writes a ledger entry and moves the balance together", async () => {
    const userId = await makeUser();

    await creditWallet(
      {
        userId,
        type: "deposit",
        amount: decimal("125.5"),
        description: "Test credit",
        buckets: { totalDeposited: decimal("125.5") },
      },
      OPERATOR,
    );

    const balance = await balanceOf(userId);
    assert.equal(Number(balance.available), 125.5);
    assert.equal(Number(balance.totalDeposited), 125.5);

    const ledger = await ledgerFor(userId);
    assert.equal(ledger.length, 1, "the balance must never move without an entry");
    assert.equal(ledger[0].type, "deposit");
    assert.equal(Number(ledger[0].amount), 125.5);
  });

  test("the ledger always sums to the balance", async () => {
    const userId = await makeUser();

    for (const amount of ["10", "0.000001", "3.25", "1000.1"]) {
      await creditWallet(
        { userId, type: "reward", amount: decimal(amount), description: `+${amount}` },
        OPERATOR,
      );
    }

    const [{ total }] = await db
      .select({ total: sql<string>`coalesce(sum(${t.transactions.amount}), 0)::text` })
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));

    const balance = await balanceOf(userId);
    // Compared as exact decimals: the point of the exercise is that these
    // agree to the last digit, which a float comparison would not prove.
    assert.equal(decimal(total), decimal(balance.available));
    assert.equal(decimal(balance.available), decimal("1013.350001"));
  });

  test("a debit that would overdraw is refused, and nothing is written", async () => {
    const userId = await makeUser();
    await creditWallet(
      { userId, type: "deposit", amount: decimal("10"), description: "seed" },
      OPERATOR,
    );

    const { debitWallet } = await import("./services/wallet.service");
    await assert.rejects(() =>
      debitWallet(
        { userId, type: "withdrawal", amount: decimal("10.00000001"), description: "too much" },
        OPERATOR,
      ),
    );

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("10"), "balance must be untouched");

    const ledger = await ledgerFor(userId);
    assert.equal(ledger.length, 1, "the refused debit must leave no ledger entry");
  });

  test("a failure inside the unit of work rolls the whole thing back", async () => {
    const userId = await makeUser();
    const { mutate } = await import("./write");
    const { applyLedgerEntry } = await import("./repositories/wallet.repository");

    await assert.rejects(() =>
      mutate(OPERATOR, async ({ tx, now }) => {
        await applyLedgerEntry(tx, {
          userId,
          type: "deposit",
          amount: decimal("500"),
          description: "will be rolled back",
          occurredAt: now,
        });
        throw new Error("deliberate failure after the write");
      }),
    );

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("0"));
    assert.equal((await ledgerFor(userId)).length, 0);
  });

  /* --------------------------------------------------------------- deposits */

  function observed(txHash: string, amount: Decimal) {
    return {
      txHash,
      from: "TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS",
      to: "TZ4UXDV5ZhNW7fb2AMSbgfAEZ7hWsnYS2g",
      contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      tokenSymbol: "USDT",
      amount,
      blockNumber: BigInt(60_000_000),
      blockTimestamp: new Date(),
      network: "shasta" as const,
      confirmed: true,
      confirmationsRequired: 1,
    };
  }

  test("the same blockchain transaction is only ever recorded once", async () => {
    const txHash = `test-${newId("tx")}`;

    const first = await recordObservedDeposit(observed(txHash, decimal("42")));
    const second = await recordObservedDeposit(observed(txHash, decimal("42")));
    const third = await recordObservedDeposit(observed(txHash, decimal("999")));

    createdDeposits.push(first.depositId);

    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "unchanged");
    // Even a different amount for the same hash does not create a second row:
    // the transaction hash is the identity, not the amount.
    assert.equal(third.outcome, "unchanged");

    const rows = await db
      .select({ id: t.deposits.id })
      .from(t.deposits)
      .where(and(eq(t.deposits.chain, "tron"), eq(t.deposits.txHash, txHash)));
    assert.equal(rows.length, 1);
  });

  test("a recorded deposit belongs to nobody until an operator says so", async () => {
    const txHash = `test-${newId("tx")}`;
    const { depositId } = await recordObservedDeposit(observed(txHash, decimal("7.5")));
    createdDeposits.push(depositId);

    const [row] = await db
      .select()
      .from(t.deposits)
      .where(eq(t.deposits.id, depositId));

    assert.equal(row.userId, null, "the scanner must never guess an owner");
    assert.equal(row.status, "confirmed");
    assert.equal(row.verification, "verified");
    assert.equal(row.senderAddress, observed(txHash, decimal("1")).from);
  });

  test("assignment credits the wallet exactly once", async () => {
    const userId = await makeUser();
    const txHash = `test-${newId("tx")}`;
    const { depositId } = await recordObservedDeposit(observed(txHash, decimal("250.75")));
    createdDeposits.push(depositId);

    await assignDepositToUser({ depositId, userId, note: "matched by support" }, OPERATOR);

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("250.75"));
    assert.equal(decimal(balance.totalDeposited), decimal("250.75"));

    const ledger = await ledgerFor(userId);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].reference, txHash, "the entry cites the chain transaction");

    // A second attempt must not credit again.
    await assert.rejects(
      () => assignDepositToUser({ depositId, userId }, OPERATOR),
      DepositError,
    );

    const after = await balanceOf(userId);
    assert.equal(decimal(after.available), decimal("250.75"));
    assert.equal((await ledgerFor(userId)).length, 1);
  });

  test("an unconfirmed deposit cannot be credited", async () => {
    const userId = await makeUser();
    const txHash = `test-${newId("tx")}`;
    const { depositId } = await recordObservedDeposit({
      ...observed(txHash, decimal("5")),
      confirmed: false,
    });
    createdDeposits.push(depositId);

    await assert.rejects(
      () => assignDepositToUser({ depositId, userId }, OPERATOR),
      DepositError,
    );
    assert.equal(decimal((await balanceOf(userId)).available), decimal("0"));
  });

  test("an ignored deposit cannot be credited", async () => {
    const userId = await makeUser();
    const txHash = `test-${newId("tx")}`;
    const { depositId } = await recordObservedDeposit(observed(txHash, decimal("5")));
    createdDeposits.push(depositId);

    await ignoreDeposit({ depositId, reason: "exchange test transfer" }, OPERATOR);
    await assert.rejects(
      () => assignDepositToUser({ depositId, userId }, OPERATOR),
      DepositError,
    );
  });

  test("every deposit action leaves an audit entry", async () => {
    const txHash = `test-${newId("tx")}`;
    const { depositId } = await recordObservedDeposit(observed(txHash, decimal("3")));
    createdDeposits.push(depositId);
    await ignoreDeposit({ depositId, reason: "audited reason" }, OPERATOR);

    const entries = await db
      .select({ details: t.auditLogs.details, action: t.auditLogs.action })
      .from(t.auditLogs)
      .where(eq(t.auditLogs.targetId, depositId));

    assert.ok(entries.length >= 2, "detection and the decision are both recorded");
    // The operator's stated reason has to reach the entry, or the confirmation
    // dialog's promise that it is recorded would be false.
    assert.ok(entries.some((entry) => entry.details.includes("audited reason")));
  });

  /* ------------------------------------------------------------- earnings -- */

  test("an investment earning settles once per period", async () => {
    const userId = await makeUser();
    const [plan] = await db.select().from(t.plans).limit(1);
    const investmentId = newId("inv_test");

    await db.insert(t.investments).values({
      id: investmentId,
      userId,
      planId: plan.id,
      planName: plan.name,
      amount: sql`100::numeric`,
      startedAt: new Date(),
      maturesAt: new Date(),
      durationDays: 30,
      rewardFrequency: "daily",
      risk: plan.risk,
    });

    const first = await recordInvestmentEarning({
      investmentId,
      userId,
      amount: decimal("1.25"),
      periodKey: "p1",
      periodIndex: 1,
      planName: plan.name,
    });
    const replay = await recordInvestmentEarning({
      investmentId,
      userId,
      amount: decimal("1.25"),
      periodKey: "p1",
      periodIndex: 1,
      planName: plan.name,
    });

    assert.equal(first.credited, true);
    assert.equal(replay.credited, false, "a replayed scheduler run must not pay twice");

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("1.25"));
    assert.equal(decimal(balance.totalProfit), decimal("1.25"));
  });

  test("two concurrent settlement attempts for the same period pay once", async () => {
    /*
     * Two cron invocations overlapping — a slow instance and a retry, or two
     * schedulers pointed at the same secret — racing to credit the same
     * period. The unique index on (investment_id, period_key) is what decides
     * this, not application logic: both requests reach `INSERT … ON CONFLICT
     * DO NOTHING` at the database, and only one can win.
     */
    const userId = await makeUser();
    const [plan] = await db.select().from(t.plans).limit(1);
    const investmentId = newId("inv_test");

    await db.insert(t.investments).values({
      id: investmentId,
      userId,
      planId: plan.id,
      planName: plan.name,
      amount: sql`100::numeric`,
      startedAt: new Date(),
      maturesAt: new Date(),
      durationDays: 30,
      rewardFrequency: "daily",
      risk: plan.risk,
    });

    const attempt = () =>
      recordInvestmentEarning({
        investmentId,
        userId,
        amount: decimal("3.33333333"),
        periodKey: "p1",
        periodIndex: 1,
        planName: plan.name,
      });

    const [a, b] = await Promise.all([attempt(), attempt()]);
    const outcomes = [a.credited, b.credited].sort();
    assert.deepEqual(outcomes, [false, true], "exactly one of the two attempts pays");

    const balance = await balanceOf(userId);
    assert.equal(
      decimal(balance.totalProfit),
      decimal("3.33333333"),
      "the period is paid once, not twice, however many attempts race for it",
    );

    const [row] = await db
      .select({ earningsCreditedPeriods: t.investments.earningsCreditedPeriods })
      .from(t.investments)
      .where(eq(t.investments.id, investmentId));
    assert.equal(row.earningsCreditedPeriods, 1, "the cursor advances once, not twice");
  });

  /* ------------------------------------------------------------- account --- */

  test("verification status and notifications persist", async () => {
    const userId = await makeUser({ kycStatus: "not_started" });

    await setKycStatus({ userId, status: "verified", reason: "documents checked" }, OPERATOR);
    await createNotification({
      userId,
      category: "deposit",
      title: "Deposit credited",
      body: "Your deposit has been credited.",
    });

    const [user] = await db.select().from(t.users).where(eq(t.users.id, userId));
    assert.equal(user.kycStatus, "verified");

    const notifications = await db
      .select()
      .from(t.notifications)
      .where(eq(t.notifications.userId, userId));
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].read, false);
  });
});
