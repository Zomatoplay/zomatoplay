import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq, sql } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";

import { operatorHolds, type Operator } from "./admin/session";
import { creditWalletManually, findCustomerForCredit } from "./services/manual-credit.service";
import { newId, type Actor } from "./write";

/**
 * Manual USDT credits against the real database: the money moves through the
 * ledger, exactly once per confirmation, with its audit entry — or not at all.
 *
 * Each test makes its own throwaway account and removes it afterwards.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_credit_test",
  name: "Credit Test Operator",
  role: "master_admin",
};

describe("manual USDT credit", { skip }, () => {
  let db: Database;
  const users: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of users) {
      // RESTRICT on both foreign keys: the decision rows go before the
      // account (and the ledger rows it cascades).
      await db.delete(t.manualCredits).where(eq(t.manualCredits.userId, id));
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser(available = "0") {
    const id = newId("usr_mc");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-C${suffix}`,
      fullName: "Credit Test",
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      referralCode: `MC${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id, available: Number(available) });
    users.push(id);
    return id;
  }

  async function available(userId: string) {
    const [row] = await db
      .select({ value: sql<string>`${t.walletBalances.available}::text` })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return row.value;
  }

  async function ledger(userId: string) {
    return db.select().from(t.transactions).where(eq(t.transactions.userId, userId));
  }

  async function credits(userId: string) {
    return db.select().from(t.manualCredits).where(eq(t.manualCredits.userId, userId));
  }

  test("a valid credit moves the balance through one ledger entry, with a record and an audit entry", async () => {
    const userId = await makeUser("10");
    const key = randomUUID();

    const result = await creditWalletManually(
      { userId, amount: "25.5", note: "short deposit DEP-TEST", idempotencyKey: key },
      OPERATOR,
    );

    assert.equal(result.duplicate, false);
    assert.equal(result.amountUsdt, "25.5");
    assert.equal(await available(userId), "35.50000000", "10 + 25.5, exactly");

    const entries = await ledger(userId);
    assert.equal(entries.length, 1, "one ledger row");
    assert.equal(entries[0].id, result.ledgerTxId);
    assert.equal(entries[0].type, "adjustment");
    assert.equal(entries[0].amount, 25.5);
    assert.equal(entries[0].status, "completed");
    assert.equal(entries[0].reference, result.creditId, "the entry names the credit");

    const [record] = await credits(userId);
    assert.equal(record.id, result.creditId);
    assert.equal(record.ledgerTxId, result.ledgerTxId);
    assert.equal(record.idempotencyKey, key);
    assert.equal(record.note, "short deposit DEP-TEST");
    assert.equal(record.createdById, OPERATOR.id);
    assert.equal(record.createdByName, OPERATOR.name);

    const audits = await db
      .select()
      .from(t.auditLogs)
      .where(and(eq(t.auditLogs.targetId, userId), eq(t.auditLogs.action, "wallet_manual_credit")));
    assert.equal(audits.length, 1, "one audit entry");
    assert.equal(audits[0].actorId, OPERATOR.id);
    assert.match(audits[0].details, /25\.5 USDT/);
    assert.match(audits[0].details, new RegExp(result.creditId));
    assert.match(audits[0].details, /Reason: short deposit DEP-TEST/);
  });

  test("the ledger still sums to the balance", async () => {
    const userId = await makeUser("0");
    await creditWalletManually({ userId, amount: "7", idempotencyKey: randomUUID() }, OPERATOR);
    await creditWalletManually({ userId, amount: "0.125", idempotencyKey: randomUUID() }, OPERATOR);
    const [sum] = await db
      .select({ total: sql<string>`coalesce(sum(${t.transactions.amount}), 0)::text` })
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
    assert.equal(sum.total, "7.12500000");
    assert.equal(await available(userId), "7.12500000");
  });

  test("the same confirmation submitted twice credits once", async () => {
    const userId = await makeUser("0");
    const key = randomUUID();
    const first = await creditWalletManually({ userId, amount: "50", idempotencyKey: key }, OPERATOR);
    const second = await creditWalletManually({ userId, amount: "50", idempotencyKey: key }, OPERATOR);

    assert.equal(second.duplicate, true);
    assert.equal(second.creditId, first.creditId);
    assert.equal(second.ledgerTxId, first.ledgerTxId);
    assert.equal(await available(userId), "50.00000000");
    assert.equal((await ledger(userId)).length, 1);
    assert.equal((await credits(userId)).length, 1);
  });

  test("a double-click — concurrent requests with one key — credits once", async () => {
    const userId = await makeUser("0");
    const key = randomUUID();
    const results = await Promise.allSettled(
      Array.from({ length: 4 }, () =>
        creditWalletManually({ userId, amount: "12", idempotencyKey: key }, OPERATOR),
      ),
    );
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 4, "every request is answered");
    const applied = fulfilled.filter((r) => r.status === "fulfilled" && !r.value.duplicate);
    assert.equal(applied.length, 1, "exactly one of them credited");
    assert.equal(await available(userId), "12.00000000");
    assert.equal((await ledger(userId)).length, 1);
  });

  test("a key reused for a different amount is refused and credits nothing", async () => {
    const userId = await makeUser("0");
    const key = randomUUID();
    await creditWalletManually({ userId, amount: "5", idempotencyKey: key }, OPERATOR);
    await assert.rejects(
      creditWalletManually({ userId, amount: "500", idempotencyKey: key }, OPERATOR),
      { name: "ManualCreditError", message: /already used for a different credit/ },
    );
    assert.equal(await available(userId), "5.00000000");
  });

  test("an unknown customer is refused and nothing is written", async () => {
    const before = await db.select({ n: sql<number>`count(*)::int` }).from(t.manualCredits);
    await assert.rejects(
      creditWalletManually(
        { userId: "usr_does_not_exist_000", amount: "5", idempotencyKey: randomUUID() },
        OPERATOR,
      ),
      { name: "ManualCreditError", message: /does not exist/ },
    );
    const afterCount = await db.select({ n: sql<number>`count(*)::int` }).from(t.manualCredits);
    assert.equal(afterCount[0].n, before[0].n);
    assert.equal(await findCustomerForCredit("usr_does_not_exist_000"), null);
  });

  test("invalid amounts are refused before any write", async () => {
    const userId = await makeUser("3");
    for (const amount of ["0", "-1", "abc", "1.0000001", "100000.01"]) {
      await assert.rejects(
        creditWalletManually({ userId, amount, idempotencyKey: randomUUID() }, OPERATOR),
        { name: "ManualCreditError" },
        amount,
      );
    }
    assert.equal(await available(userId), "3.00000000");
    assert.equal((await ledger(userId)).length, 0);
    assert.equal((await credits(userId)).length, 0);
  });

  test("a customer can never be the actor of a manual credit", async () => {
    const userId = await makeUser("0");
    await assert.rejects(
      creditWalletManually(
        { userId, amount: "100", idempotencyKey: randomUUID() },
        { kind: "user", id: userId, name: "Customer", role: "agent" },
      ),
      { name: "ManualCreditError", message: /Only an operator/ },
    );
    assert.equal(await available(userId), "0.00000000");
  });

  test("a failure late in the transaction rolls the whole credit back", async () => {
    const userId = await makeUser("1");
    // An actor with no name violates NOT NULL on the decision row, which is
    // written after the ledger entry and balance move — so this proves those
    // earlier writes do not survive a later failure.
    const broken = { ...OPERATOR, name: null as unknown as string };
    await assert.rejects(
      creditWalletManually({ userId, amount: "40", idempotencyKey: randomUUID() }, broken),
    );
    assert.equal(await available(userId), "1.00000000", "balance unchanged");
    assert.equal((await ledger(userId)).length, 0, "no ledger row");
    assert.equal((await credits(userId)).length, 0, "no credit record");
    const audits = await db
      .select()
      .from(t.auditLogs)
      .where(and(eq(t.auditLogs.targetId, userId), eq(t.auditLogs.action, "wallet_manual_credit")));
    assert.equal(audits.length, 0, "no audit entry");
  });

  test("the lookup shows who an id belongs to, masked", async () => {
    const userId = await makeUser("2");
    await db.update(t.users).set({ phoneE164: null }).where(eq(t.users.id, userId));
    const customer = await findCustomerForCredit(userId);
    assert.ok(customer);
    assert.equal(customer.userId, userId);
    assert.equal(customer.fullName, "Credit Test");
    assert.equal(customer.availableUsdt, 2);
  });

  test("Manual Debit: removes funds through one negative ledger entry, records direction, reason and resulting balance", async () => {
    const userId = await makeUser("40");
    const result = await creditWalletManually(
      { userId, amount: "15.25", note: "duplicate credit reversed", idempotencyKey: randomUUID(), direction: "debit" },
      OPERATOR,
    );
    assert.equal(result.direction, "debit");
    assert.equal(await available(userId), "24.75000000", "40 − 15.25, exactly");
    assert.equal(result.balanceAfterUsdt, "24.75");

    const entries = await ledger(userId);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, -15.25);
    assert.equal(entries[0].type, "adjustment");
    assert.equal(entries[0].reference, result.creditId);

    const [record] = await credits(userId);
    assert.equal(record.direction, "debit");
    assert.equal(record.balanceAfterUsdt, 24.75);
    assert.equal(record.note, "duplicate credit reversed");

    const audits = await db
      .select()
      .from(t.auditLogs)
      .where(and(eq(t.auditLogs.targetId, userId), eq(t.auditLogs.action, "wallet_manual_debit")));
    assert.equal(audits.length, 1);
    assert.match(audits[0].details, /available balance now 24\.75/);
  });

  test("Manual Debit: refuses to overdraw and changes nothing", async () => {
    const userId = await makeUser("5");
    await assert.rejects(
      creditWalletManually(
        { userId, amount: "5.01", note: "too much", idempotencyKey: randomUUID(), direction: "debit" },
        OPERATOR,
      ),
      /lower than this debit/,
    );
    assert.equal(await available(userId), "5.00000000");
    assert.equal((await ledger(userId)).length, 0);
    assert.equal((await credits(userId)).length, 0);
  });

  test("Manual Debit: requires a reason; a replayed key is applied once; a key cannot switch direction", async () => {
    const userId = await makeUser("50");
    await assert.rejects(
      creditWalletManually({ userId, amount: "1", idempotencyKey: randomUUID(), direction: "debit" }, OPERATOR),
      /needs a reason/,
    );
    const key = randomUUID();
    const first = await creditWalletManually(
      { userId, amount: "10", note: "correction", idempotencyKey: key, direction: "debit" },
      OPERATOR,
    );
    const replay = await creditWalletManually(
      { userId, amount: "10", note: "correction", idempotencyKey: key, direction: "debit" },
      OPERATOR,
    );
    assert.equal(replay.duplicate, true);
    assert.equal(replay.creditId, first.creditId);
    assert.equal(await available(userId), "40.00000000", "debited once");
    await assert.rejects(
      creditWalletManually({ userId, amount: "10", note: "x", idempotencyKey: key, direction: "credit" }, OPERATOR),
      /already used/,
    );
  });
});

describe("manual credit permission", () => {
  const base: Omit<Operator, "role" | "permissions"> = {
    actor: OPERATOR,
    agentId: "agt_x",
    name: "X",
    email: "x@example.invalid",
  };

  test("an agent without the grant cannot credit", () => {
    const agent: Operator = { ...base, role: "agent", permissions: { deposits: "manage", withdrawals: "manage" } };
    assert.equal(operatorHolds(agent, "wallet_credits", "manage"), false);
    assert.equal(operatorHolds(agent, "wallet_credits", "view"), false);
  });

  test("view is not manage", () => {
    const agent: Operator = { ...base, role: "agent", permissions: { wallet_credits: "view" } };
    assert.equal(operatorHolds(agent, "wallet_credits", "view"), true);
    assert.equal(operatorHolds(agent, "wallet_credits", "manage"), false);
  });

  test("an explicit manage grant, or the master admin role, can credit", () => {
    const agent: Operator = { ...base, role: "agent", permissions: { wallet_credits: "manage" } };
    const master: Operator = { ...base, role: "master_admin", permissions: {} };
    assert.equal(operatorHolds(agent, "wallet_credits", "manage"), true);
    assert.equal(operatorHolds(master, "wallet_credits", "manage"), true);
  });
});
