import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq, inArray } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";

import { recordObservedDeposit } from "./services/deposits.service";
import {
  cancelDepositRequest,
  createDepositRequest,
  DepositRequestError,
  submitDepositTransactionHash,
} from "./services/deposit-requests.service";
import { newId, type Actor } from "./write";

/**
 * A deposit request's life from the customer's side: changing the amount,
 * leaving the screen, paying after cancelling, and resubmitting a hash that
 * was already processed — through the real services, against a real database.
 *
 * SAFETY OF THE FIXTURES
 * ----------------------
 * `createDepositRequest` quotes the configured address, so this file points
 * the TRON configuration at `nile` and at a freshly generated address — valid
 * base58check, 20 random bytes nobody holds a key for — for the duration of
 * the file, and restores it afterwards. No request is ever created against
 * the real deposit address, and every row is deleted in `after()`.
 * Nothing here calls TronGrid: the hash paths exercised are the ones decided
 * from the ledger before the chain is asked.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const BASE58 = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58(bytes: Buffer): string {
  let value = BigInt(`0x${bytes.toString("hex")}`);
  let out = "";
  while (value > BigInt(0)) {
    out = BASE58[Number(value % BigInt(58))] + out;
    value /= BigInt(58);
  }
  for (const byte of bytes) {
    if (byte !== 0) break;
    out = `1${out}`;
  }
  return out;
}
function unownedTronAddress(): string {
  const payload = Buffer.concat([Buffer.from([0x41]), randomBytes(20)]);
  const sha = (data: Buffer) => createHash("sha256").update(data).digest();
  return base58(Buffer.concat([payload, sha(sha(payload)).subarray(0, 4)]));
}
const hexHash = () => randomBytes(32).toString("hex");

describe("deposit requests: change, cancel, and replay", { skip }, () => {
  let db: Database;
  const users: string[] = [];
  const deposits: string[] = [];
  const ADDRESS = unownedTronAddress();
  const savedEnv = {
    network: process.env.TRON_NETWORK,
    address: process.env.TRON_PLATFORM_DEPOSIT_ADDRESS,
    legacyAddress: process.env.TRON_DEPOSIT_ADDRESS,
    contract: process.env.TRON_USDT_CONTRACT,
  };

  before(() => {
    db = createAdminDb();
    process.env.TRON_NETWORK = "nile";
    process.env.TRON_PLATFORM_DEPOSIT_ADDRESS = ADDRESS;
    delete process.env.TRON_DEPOSIT_ADDRESS;
    // Nile's USDT; only its presence matters here (`isTronConfigured`).
    process.env.TRON_USDT_CONTRACT ??= "TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf";
  });

  after(async () => {
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    };
    restore("TRON_NETWORK", savedEnv.network);
    restore("TRON_PLATFORM_DEPOSIT_ADDRESS", savedEnv.address);
    restore("TRON_DEPOSIT_ADDRESS", savedEnv.legacyAddress);
    restore("TRON_USDT_CONTRACT", savedEnv.contract);

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
    if (users.length > 0) {
      await db.delete(t.auditLogs).where(inArray(t.auditLogs.targetId, users));
    }
    for (const id of users) await db.delete(t.users).where(eq(t.users.id, id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser(tag: string) {
    const id = newId("usr_test");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-L${suffix}`,
      fullName: `Deposit Lifecycle ${tag}`,
      email: `deposit-lifecycle-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `DLC${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    users.push(id);
    return id;
  }

  const actorFor = (userId: string): Actor => ({
    kind: "user",
    id: userId,
    name: "Deposit Lifecycle",
    role: "agent",
  });

  async function requestRow(id: string) {
    const [row] = await db.select().from(t.depositRequests).where(eq(t.depositRequests.id, id));
    return row;
  }

  async function balanceOf(userId: string) {
    const [row] = await db
      .select({ available: t.walletBalances.available })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return Number(row?.available ?? 0);
  }

  function transferOf(amount: string, txHash = hexHash()) {
    return {
      txHash,
      from: "TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS",
      to: ADDRESS,
      contract: process.env.TRON_USDT_CONTRACT ?? "",
      tokenSymbol: "USDT",
      amount: decimal(amount),
      blockNumber: BigInt(60_000_000),
      blockTimestamp: new Date(),
      network: "nile" as const,
      confirmed: true,
      confirmationsRequired: 1,
    };
  }

  test("the requests are quoted the test address, never the real one", async () => {
    const user = await makeUser("address");
    const request = await createDepositRequest({ userId: user, amount: "25" }, actorFor(user));
    assert.equal(request.receivingAddress, ADDRESS);
    assert.equal(request.network, "nile");
  });

  test("the same amount twice (a double-tap, a refresh) returns the same request", async () => {
    const user = await makeUser("same");
    const first = await createDepositRequest({ userId: user, amount: "40" }, actorFor(user));
    const second = await createDepositRequest({ userId: user, amount: "40" }, actorFor(user));
    assert.equal(second.id, first.id);
    assert.equal(second.expectedAmountUsdt, first.expectedAmountUsdt);
  });

  test("changing the amount cancels the waiting request; exactly one is left waiting", async () => {
    const user = await makeUser("change");
    const first = await createDepositRequest({ userId: user, amount: "100" }, actorFor(user));
    const second = await createDepositRequest({ userId: user, amount: "150" }, actorFor(user));

    assert.notEqual(second.id, first.id, "a new Deposit Request ID");
    assert.notEqual(second.expectedAmountUsdt, first.expectedAmountUsdt, "a new exact amount");

    const old = await requestRow(first.id);
    assert.equal(old.status, "cancelled");
    assert.equal(old.cancellationReason, "amount_changed");
    assert.ok(old.cancelledAt, "cancelled, with a time — never deleted");

    const waiting = await db
      .select({ id: t.depositRequests.id })
      .from(t.depositRequests)
      .where(
        and(
          eq(t.depositRequests.userId, user),
          eq(t.depositRequests.status, "awaiting_payment"),
        ),
      );
    assert.deepEqual(waiting.map((row) => row.id), [second.id]);

    const audit = await db
      .select({ details: t.auditLogs.details })
      .from(t.auditLogs)
      .where(eq(t.auditLogs.targetId, user));
    assert.ok(
      audit.some((entry) => entry.details.includes(first.id)),
      "the cancellation is in the audit trail",
    );
  });

  test("a cancelled request's exact amount is not quoted again while its window is open", async () => {
    const user = await makeUser("reserve-a");
    const other = await makeUser("reserve-b");
    const cancelled = await createDepositRequest({ userId: user, amount: "60" }, actorFor(user));
    await cancelDepositRequest(
      { userId: user, requestId: cancelled.id, reason: "left_page" },
      actorFor(user),
    );

    // Occupy every other 60.xx offset but one, so the only two candidates left
    // are the cancelled request's figure and `free`. A deterministic check,
    // not a 1-in-99 chance.
    const offsets = Array.from({ length: 99 }, (_, i) => `60.${String(i + 1).padStart(2, "0")}`);
    const free = offsets.find((amount) => amount !== cancelled.expectedAmountUsdt)!;
    const now = Date.now();
    await db.insert(t.depositRequests).values(
      offsets
        .filter((amount) => amount !== cancelled.expectedAmountUsdt && amount !== free)
        .map((amount, index) => ({
          id: `DEP-R${index.toString().padStart(2, "0")}${randomBytes(2).toString("hex").toUpperCase().slice(0, 3)}`,
          userId: other,
          chain: "tron" as const,
          chainNetwork: "nile" as const,
          asset: "usdt" as const,
          receivingAddress: ADDRESS,
          requestedAmountUsdt: 60,
          expectedAmountUsdt: Number(amount),
          // `expired` but with its window still open: reserved, and outside
          // the one-waiting-request index.
          status: "expired" as const,
          createdAt: new Date(now - 60_000),
          expiresAt: new Date(now + 60 * 60_000),
        })),
    );

    const quote = await createDepositRequest({ userId: other, amount: "60" }, actorFor(other));
    assert.equal(quote.expectedAmountUsdt, free, "the cancelled figure is still reserved");
  });

  test("leaving cancels a waiting request; a second cancel is a no-op", async () => {
    const user = await makeUser("leave");
    const request = await createDepositRequest({ userId: user, amount: "30" }, actorFor(user));

    const first = await cancelDepositRequest(
      { userId: user, requestId: request.id, reason: "left_page" },
      actorFor(user),
    );
    const second = await cancelDepositRequest(
      { userId: user, requestId: request.id, reason: "left_page" },
      actorFor(user),
    );

    assert.equal(first.outcome, "cancelled");
    assert.equal(second.outcome, "already_closed");
    const row = await requestRow(request.id);
    assert.equal(row.status, "cancelled");
    assert.equal(row.cancellationReason, "left_page");
  });

  test("a request with a submitted transaction cannot be cancelled", async () => {
    const user = await makeUser("evidence");
    const request = await createDepositRequest({ userId: user, amount: "35" }, actorFor(user));
    const hash = hexHash();
    await db
      .update(t.depositRequests)
      .set({ status: "verifying", submittedTxHash: hash, submittedAt: new Date() })
      .where(eq(t.depositRequests.id, request.id));

    const result = await cancelDepositRequest(
      { userId: user, requestId: request.id, reason: "left_page" },
      actorFor(user),
    );
    assert.equal(result.outcome, "has_evidence");
    const row = await requestRow(request.id);
    assert.equal(row.status, "verifying", "the evidence is untouched");
    assert.equal(row.submittedTxHash, hash);

    // Starting another deposit does not cancel it either.
    await createDepositRequest({ userId: user, amount: "45" }, actorFor(user));
    assert.equal((await requestRow(request.id)).status, "verifying");
  });

  test("nobody can cancel another customer's request", async () => {
    const owner = await makeUser("owner");
    const stranger = await makeUser("stranger");
    const request = await createDepositRequest({ userId: owner, amount: "55" }, actorFor(owner));

    await assert.rejects(
      cancelDepositRequest(
        { userId: stranger, requestId: request.id, reason: "left_page" },
        actorFor(stranger),
      ),
      DepositRequestError,
    );
    assert.equal((await requestRow(request.id)).status, "awaiting_payment");
  });

  test("paying a cancelled request inside its window still credits its owner, once", async () => {
    const user = await makeUser("paid-then-left");
    const request = await createDepositRequest({ userId: user, amount: "80" }, actorFor(user));
    await cancelDepositRequest(
      { userId: user, requestId: request.id, reason: "left_page" },
      actorFor(user),
    );

    const transfer = transferOf(request.expectedAmountUsdt);
    const first = await recordObservedDeposit(transfer);
    deposits.push(first.depositId);
    await recordObservedDeposit(transfer); // the scanner seeing it again

    assert.equal(await balanceOf(user), Number(request.expectedAmountUsdt));
    const row = await requestRow(request.id);
    assert.equal(row.status, "credited");
    assert.equal(row.depositId, first.depositId);
  });

  test("resubmitting a processed hash says so and credits nothing more", async () => {
    const owner = await makeUser("resubmit");
    const other = await makeUser("resubmit-other");
    const request = await createDepositRequest({ userId: owner, amount: "90" }, actorFor(owner));
    const otherRequest = await createDepositRequest(
      { userId: other, amount: "91" },
      actorFor(other),
    );

    const transfer = transferOf(request.expectedAmountUsdt);
    const credited = await recordObservedDeposit(transfer);
    deposits.push(credited.depositId);
    const balance = await balanceOf(owner);

    const again = await submitDepositTransactionHash({
      userId: owner,
      requestId: request.id,
      txHash: transfer.txHash,
    });
    assert.equal(again.outcome, "already_processed");

    const elsewhere = await submitDepositTransactionHash({
      userId: other,
      requestId: otherRequest.id,
      txHash: transfer.txHash.toUpperCase(),
    });
    assert.equal(elsewhere.outcome, "already_used", "another customer's claim on it");

    assert.equal(await balanceOf(owner), balance, "no second credit");
    assert.equal(await balanceOf(other), 0);
    assert.equal((await requestRow(otherRequest.id)).status, "awaiting_payment");
  });

  test("the database refuses two waiting requests for one customer", async () => {
    const user = await makeUser("one-waiting");
    await createDepositRequest({ userId: user, amount: "20" }, actorFor(user));
    await assert.rejects(
      db.insert(t.depositRequests).values({
        id: `DEP-T${Date.now().toString(36).toUpperCase().slice(-7)}`,
        userId: user,
        chain: "tron",
        chainNetwork: "nile",
        asset: "usdt",
        receivingAddress: ADDRESS,
        requestedAmountUsdt: 21,
        expectedAmountUsdt: 21.5,
        status: "awaiting_payment",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 60 * 60_000),
      }),
      (error: unknown) => {
        const cause = (error as { cause?: { code?: string; constraint_name?: string } }).cause;
        assert.equal(cause?.code, "23505");
        assert.equal(cause?.constraint_name, "deposit_requests_one_awaiting_per_user_key");
        return true;
      },
    );
  });
});
