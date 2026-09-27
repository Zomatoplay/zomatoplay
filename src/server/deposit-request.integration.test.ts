import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq, inArray } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

import { assignDepositToUser, recordObservedDeposit } from "./services/deposits.service";
import { newDepositRequestId } from "./services/deposit-requests.service";
import { newId, type Actor } from "./write";

/**
 * The single-address deposit design, against a real database.
 *
 * Every property here is one the unique-amount binding exists to guarantee:
 * the right person is credited, exactly once, whoever submits the hash and
 * however many times — and anything that is not an exact match waits for a
 * person rather than being guessed.
 *
 * SAFETY OF THE FIXTURES
 * ----------------------
 * The configured database is also scanned for real deposits. Every request here
 * is quoted a made-up receiving address on `shasta`, which no real transfer
 * can reach, which fails base58check (so the scanner's watch list drops it),
 * and which is deleted in `after()`. Nothing here creates a request against the
 * real deposit address — a test request there could match a real customer's
 * transfer.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_test",
  name: "Test Operator",
  role: "master_admin",
};

describe("deposit requests: matching and crediting", { skip }, () => {
  let db: Database;
  const users: string[] = [];
  const deposits: string[] = [];
  // Unique per run, and deliberately not a valid TRON address.
  const ADDRESS = `TEST-DEPOSIT-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    const found = await db
      .select({ id: t.deposits.id })
      .from(t.deposits)
      .where(eq(t.deposits.walletAddress, ADDRESS));
    const ids = Array.from(new Set([...deposits, ...found.map((row) => row.id)]));
    if (ids.length > 0) {
      await db.delete(t.depositRequests).where(inArray(t.depositRequests.depositId, ids));
      await db.delete(t.auditLogs).where(inArray(t.auditLogs.targetId, ids));
      await db.delete(t.deposits).where(inArray(t.deposits.id, ids));
    }
    // Cascades clear wallets, ledger rows and the remaining requests.
    for (const id of users) await db.delete(t.users).where(eq(t.users.id, id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser(tag: string) {
    const id = newId("usr_test");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-Q${suffix}`,
      fullName: `Deposit Request ${tag}`,
      email: `deposit-request-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `DRQ${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    users.push(id);
    return id;
  }

  async function makeRequest(
    userId: string,
    expected: string,
    options: { createdAt?: Date; expiresAt?: Date; status?: "awaiting_payment" | "expired" } = {},
  ) {
    const id = newDepositRequestId();
    const createdAt = options.createdAt ?? new Date(Date.now() - 5 * 60_000);
    await db.insert(t.depositRequests).values({
      id,
      userId,
      chain: "tron",
      chainNetwork: "shasta",
      asset: "usdt",
      receivingAddress: ADDRESS,
      requestedAmountUsdt: Math.floor(Number(expected)),
      expectedAmountUsdt: Number(expected),
      status: options.status ?? "awaiting_payment",
      createdAt,
      expiresAt: options.expiresAt ?? new Date(createdAt.getTime() + 60 * 60_000),
    });
    return id;
  }

  function transfer(amount: Decimal, at = new Date()) {
    return {
      txHash: `test-${newId("tx")}`,
      from: "TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS",
      to: ADDRESS,
      contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      tokenSymbol: "USDT",
      amount,
      blockNumber: BigInt(60_000_000),
      blockTimestamp: at,
      network: "shasta" as const,
      confirmed: true,
      confirmationsRequired: 1,
    };
  }

  async function balanceOf(userId: string) {
    const [row] = await db
      .select({ available: t.walletBalances.available })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return Number(row?.available ?? 0);
  }

  async function requestRow(id: string) {
    const [row] = await db.select().from(t.depositRequests).where(eq(t.depositRequests.id, id));
    return row;
  }

  async function depositRow(id: string) {
    const [row] = await db.select().from(t.deposits).where(eq(t.deposits.id, id));
    return row;
  }

  test("an exact match inside the window is credited to the request's owner, once", async () => {
    const user = await makeUser("exact");
    const request = await makeRequest(user, "150.37");
    const tx = transfer(decimal("150.37"));

    const first = await recordObservedDeposit(tx);
    deposits.push(first.depositId);
    // A replay — the scanner seeing it again, or Verify Payment pressed twice.
    const second = await recordObservedDeposit(tx);

    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "unchanged");
    assert.equal(second.depositId, first.depositId);
    assert.equal(await balanceOf(user), 150.37, "credited exactly the chain amount, once");

    const row = await requestRow(request);
    assert.equal(row.status, "credited");
    assert.equal(row.depositId, first.depositId);
    assert.equal(Number(row.verifiedAmountUsdt), 150.37);

    const ledger = await db
      .select()
      .from(t.transactions)
      .where(eq(t.transactions.reference, tx.txHash));
    assert.equal(ledger.length, 1, "one ledger row for one transfer");
  });

  test("concurrent recordings of one transfer credit exactly once", async () => {
    const user = await makeUser("race");
    await makeRequest(user, "77.12");
    const tx = transfer(decimal("77.12"));

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => recordObservedDeposit(tx)),
    );
    for (const result of results) {
      if (result.status === "fulfilled") deposits.push(result.value.depositId);
    }
    assert.ok(results.some((result) => result.status === "fulfilled"));
    assert.equal(await balanceOf(user), 77.12, "five racers, one credit");
  });

  test("somebody else submitting your hash cannot take your transfer", async () => {
    const victim = await makeUser("victim");
    const attacker = await makeUser("attacker");
    const victimRequest = await makeRequest(victim, "500.44");
    const attackerRequest = await makeRequest(attacker, "500.91");

    // The attacker watched the chain and submits the victim's hash first.
    const result = await recordObservedDeposit(transfer(decimal("500.44")), undefined, {
      requestId: attackerRequest,
      userId: attacker,
    });
    deposits.push(result.depositId);

    assert.equal(result.claim, "not_yours");
    assert.equal(await balanceOf(attacker), 0, "the claimant gains nothing");
    assert.equal(await balanceOf(victim), 500.44, "the transfer reaches the request it matches");
    assert.equal((await requestRow(victimRequest)).status, "credited");
    assert.equal(
      (await requestRow(attackerRequest)).status,
      "awaiting_payment",
      "the attacker's request is left exactly as it was",
    );
  });

  test("an amount that matches no request waits for review and credits nobody", async () => {
    const user = await makeUser("mismatch");
    const request = await makeRequest(user, "200.25");

    // Their exchange deducted a fee: 199.25 arrives, not 200.25.
    const result = await recordObservedDeposit(transfer(decimal("199.25")), undefined, {
      requestId: request,
      userId: user,
    });
    deposits.push(result.depositId);

    assert.equal(result.claim, "needs_review");
    assert.equal(await balanceOf(user), 0, "nothing is credited without an exact match");

    const deposit = await depositRow(result.depositId);
    assert.equal(deposit.userId, null);
    assert.equal(deposit.status, "confirmed");
    assert.equal(deposit.unmatchedReason, "no_matching_request");

    const row = await requestRow(request);
    assert.equal(row.status, "needs_review");
    assert.ok(row.submittedTxHash, "the claim is recorded for the operator");

    // The operator decides, and the customer's request closes with it.
    await assignDepositToUser({ depositId: result.depositId, userId: user }, OPERATOR);
    assert.equal(await balanceOf(user), 199.25);
    const closed = await requestRow(request);
    assert.equal(closed.status, "credited");
    assert.equal(closed.depositId, result.depositId);
  });

  test("a transfer outside the request's window is not credited", async () => {
    const user = await makeUser("late");
    const createdAt = new Date(Date.now() - 3 * 60 * 60_000);
    await makeRequest(user, "90.61", {
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 60 * 60_000),
      status: "expired",
    });

    const result = await recordObservedDeposit(transfer(decimal("90.61"), new Date()));
    deposits.push(result.depositId);

    assert.equal(await balanceOf(user), 0);
    assert.equal((await depositRow(result.depositId)).unmatchedReason, "outside_request_window");
  });

  test("two requests matching one transfer is refused as ambiguous, never guessed", async () => {
    const first = await makeUser("ambiguous-a");
    const second = await makeUser("ambiguous-b");
    // One expired (window still covering now) and one open: the partial unique
    // index permits it, and the matcher must not pick either.
    await makeRequest(first, "64.08", { status: "expired" });
    await makeRequest(second, "64.08");

    const result = await recordObservedDeposit(transfer(decimal("64.08")));
    deposits.push(result.depositId);

    assert.equal(await balanceOf(first), 0);
    assert.equal(await balanceOf(second), 0);
    assert.equal((await depositRow(result.depositId)).unmatchedReason, "ambiguous_match");
  });

  test("the database refuses two open requests with one exact amount at one address", async () => {
    // Two customers, so the one-waiting-request-per-customer index is not
    // what refuses it.
    const first = await makeUser("dup-amount-a");
    const second = await makeUser("dup-amount-b");
    await makeRequest(first, "33.33");
    await assert.rejects(makeRequest(second, "33.33"), (error: unknown) => {
      // Drizzle wraps the driver error; the SQLSTATE is on `cause`.
      const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
      assert.equal(cause?.code, "23505", "a unique violation");
      assert.equal(cause?.constraint_name, "deposit_requests_open_amount_key");
      return true;
    });
  });

  test("a transfer already credited cannot be claimed by anyone again", async () => {
    const owner = await makeUser("owner");
    const other = await makeUser("other");
    await makeRequest(owner, "120.18");
    const otherRequest = await makeRequest(other, "120.55");
    const tx = transfer(decimal("120.18"));

    const credited = await recordObservedDeposit(tx);
    deposits.push(credited.depositId);
    const replay = await recordObservedDeposit(tx, undefined, {
      requestId: otherRequest,
      userId: other,
    });

    assert.equal(replay.claim, "not_yours");
    assert.equal(await balanceOf(owner), 120.18);
    assert.equal(await balanceOf(other), 0);
  });
});
