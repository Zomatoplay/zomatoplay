import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";
import { readFile } from "node:fs/promises";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal } from "@/db/money";
import * as t from "@/db/schema";

import { createScanTrigger } from "./tron/scan-trigger";
import type { ScanSummary } from "./tron/scanner";
import {
  listDepositActivityForUser,
  recordObservedDeposit,
} from "./services/deposits.service";
import { newId } from "./write";

/**
 * The deposit screen's 30-second check.
 *
 * Three things are worth pinning here, and nothing else is:
 *
 *  1. **The limits on triggering a scan from a request.** A scan is global and
 *     spends TronGrid quota and database connections, so a page that asks for
 *     one every thirty seconds — times however many people have the screen
 *     open — must not turn into that many passes.
 *  2. **The action refuses an unauthenticated caller, and takes no argument
 *     that could name a different one.** Identity comes from the session or
 *     the call does not proceed.
 *  3. **What the screen reads back is scoped to the caller.** Attribution is
 *     the `deposit_addresses` mapping, read in the other direction — never an
 *     amount, a timestamp, or whoever happens to be looking.
 *
 * Crediting itself is not re-tested here: `deposit-address.integration.test.ts`
 * already owns "the same transaction hash is only ever credited once" and "two
 * concurrent scans credit exactly once", which are properties of
 * `recordObservedDeposit`, not of this screen.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

function summary(created = 0): ScanSummary {
  return {
    scanned: created,
    created,
    updated: 0,
    unchanged: 0,
    pending: 0,
    rejected: {},
    solidBlock: "1",
    errors: [],
  };
}

describe("triggering the scanner from an open deposit screen", () => {
  test("concurrent checks join one pass rather than starting several", async () => {
    let passes = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const trigger = createScanTrigger(async () => {
      passes += 1;
      await gate;
      return summary(1);
    });

    // Ten people with the screen open, all ticking at once.
    const calls = Promise.all(Array.from({ length: 10 }, () => trigger()));
    release?.();
    const results = await calls;

    assert.equal(passes, 1, "one pass, however many callers asked for it");
    assert.equal(results.filter((r) => r.outcome === "scanned").length, 1);
    assert.equal(results.filter((r) => r.outcome === "joined").length, 9);
    // A joined caller still gets the pass's real result, not an empty one.
    for (const result of results) assert.equal(result.summary?.created, 1);
  });

  test("a check arriving too soon after the last pass does not start another", async () => {
    let passes = 0;
    let clock = 1_000_000;
    const trigger = createScanTrigger(
      async () => {
        passes += 1;
        return summary();
      },
      { minIntervalMs: 20_000, now: () => clock },
    );

    assert.equal((await trigger()).outcome, "scanned");

    clock += 19_999;
    const early = await trigger();
    assert.equal(early.outcome, "throttled");
    assert.equal(early.summary, null, "a throttled check must not claim a pass ran");
    assert.equal(passes, 1);

    // The client polls every 30s, so its own next tick is always past the floor.
    clock += 30_000;
    assert.equal((await trigger()).outcome, "scanned");
    assert.equal(passes, 2);
  });

  test("a failing scan is reported, not thrown, and does not wedge the trigger", async () => {
    let clock = 0;
    let attempts = 0;
    const trigger = createScanTrigger(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("TronGrid is rate limiting");
        return summary();
      },
      { minIntervalMs: 20_000, now: () => clock },
    );

    const failed = await trigger();
    assert.equal(failed.outcome, "failed");
    assert.match(failed.error ?? "", /rate limiting/);

    // A failure counts against the floor too: an endpoint rejecting instantly
    // would otherwise be retried on every poll of every open screen.
    assert.equal((await trigger()).outcome, "throttled");

    clock += 20_000;
    assert.equal((await trigger()).outcome, "scanned", "one bad pass is not fatal");
  });
});

describe("the deposit check action", () => {
  test("refuses a caller with no session, and never scans for one", async () => {
    const { checkForDepositsAction } = await import(
      "@/app/(app)/wallet/deposit/actions"
    );

    const result = await checkForDepositsAction();

    assert.equal(result.ok, false, "an unauthenticated caller must be refused");
    assert.equal(result.deposits.length, 0, "and told nothing about anybody's deposits");
    assert.notEqual(
      result.scan,
      "scanned",
      "a signed-out caller must not be able to spend TronGrid quota",
    );
  });

  test("takes no required argument, so nothing in the browser can name a user", async () => {
    const { checkForDepositsAction } = await import(
      "@/app/(app)/wallet/deposit/actions"
    );
    /*
     * The identity is `getAuthenticatedAccount()` and there is no parameter to
     * override it with — the same property the other deposit actions have.
     *
     * The action does take one *optional* options object now (`requestScan`),
     * so `.length` still reads 0 because a parameter with a default does not
     * count. That flag decides cadence, never identity and never privilege:
     * `triggerDepositScan()` applies its own floor and single-flight to whoever
     * asks, so a browser setting it on every call gains nothing.
     */
    assert.equal(checkForDepositsAction.length, 0);
  });
});

/**
 * The cheap read and the expensive chain scan are separate cadences.
 *
 * Measured 2026-09-13: a real pass costs p50 3,891 ms, and at one scan per
 * 5-second tick the deposit screen drove a chain scan roughly every 9 s for as
 * long as it was open — to find transfers that cannot be credited until their
 * block solidifies ~57 s later. These tests pin the split so it cannot quietly
 * collapse back into one call.
 */
describe("the deposit screen's two cadences", () => {
  test("the client's scan interval stays above the server's floor, and its poll below", async () => {
    const { DEPOSIT_SCAN_MIN_INTERVAL_MS } = await import(
      "@/server/tron/scan-trigger"
    );

    // Read out of the component so the two cannot drift apart unnoticed.
    const source = await readFile(
      new URL("../components/wallet/deposit-watcher.tsx", import.meta.url),
      "utf8",
    );
    const poll = Number(
      /const POLL_INTERVAL_MS = ([\d_]+)/.exec(source)?.[1].replace(/_/g, ""),
    );
    const scan = Number(
      /const SCAN_INTERVAL_MS = ([\d_]+)/.exec(source)?.[1].replace(/_/g, ""),
    );

    assert.ok(Number.isFinite(poll) && Number.isFinite(scan), "both intervals found");

    assert.ok(
      poll < DEPOSIT_SCAN_MIN_INTERVAL_MS,
      `the cheap poll (${poll}ms) must be faster than the scan floor ` +
        `(${DEPOSIT_SCAN_MIN_INTERVAL_MS}ms) — that is the whole point of splitting them`,
    );
    assert.ok(
      scan > DEPOSIT_SCAN_MIN_INTERVAL_MS,
      `the scan request interval (${scan}ms) must clear the server floor ` +
        `(${DEPOSIT_SCAN_MIN_INTERVAL_MS}ms), or a screen's own request is refused`,
    );
    assert.ok(
      scan >= 57_000,
      `a chain scan more often than ~57s cannot produce an earlier answer: ` +
        `nothing is credited before its block solidifies (got ${scan}ms)`,
    );
  });

  test("a tick that does not request a scan runs none", async () => {
    let passes = 0;
    const { createScanTrigger } = await import("@/server/tron/scan-trigger");
    const trigger = createScanTrigger(async () => {
      passes += 1;
      return {
        scanned: 0, created: 0, updated: 0, unchanged: 0, pending: 0,
        rejected: {}, solidBlock: null, errors: [],
      };
    });

    // The action skips `triggerDepositScan` entirely when `requestScan` is
    // false; this asserts the trigger's own contract that nothing runs unless
    // it is called.
    assert.equal(passes, 0, "no pass before anyone asks");
    await trigger();
    assert.equal(passes, 1, "and exactly one when a slow tick does ask");
  });
});

describe("what an open deposit screen reads back", { skip }, () => {
  let db: Database;
  const createdUsers: string[] = [];
  const createdAddressIds: string[] = [];
  const createdDeposits: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of createdDeposits) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.deposits).where(eq(t.deposits.id, id));
    }
    for (const id of createdUsers) {
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    for (const id of createdAddressIds) {
      await db.delete(t.depositAddresses).where(eq(t.depositAddresses.id, id));
    }
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_test");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-C${suffix}`,
      fullName: "Deposit Check Test",
      email: `deposit-check-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `DCTEST${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    return id;
  }

  async function seedAssignedAddress(userId: string) {
    const id = newId("dpa_test");
    const address = `TTEST${newId("addr").slice(-28).toUpperCase()}`;
    const assignedAt = new Date();
    await db.insert(t.depositAddresses).values({
      id,
      userId,
      lastUserId: userId,
      chain: "tron",
      network: "shasta",
      asset: "usdt",
      address,
      status: "assigned",
      assignedAt,
    });
    /*
     * The open assignment interval, as `claimAvailableAddress` writes it.
     *
     * Attribution reads `deposit_address_assignments`, not
     * `deposit_addresses.user_id` — a transfer belongs to whoever held the
     * address at the transfer's own block time, which is what makes releasing
     * an address safe. A fixture without this row is an assignment no deposit
     * can be matched to.
     */
    await db.insert(t.depositAddressAssignments).values({
      id: newId("dpx_test"),
      addressId: id,
      address,
      chain: "tron",
      network: "shasta",
      asset: "usdt",
      userId,
      assignedAt,
    });
    createdAddressIds.push(id);
    return address;
  }

  function transferTo(address: string, confirmed = true) {
    return {
      txHash: `test-${newId("tx")}`,
      from: "TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS",
      to: address,
      contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      tokenSymbol: "USDT",
      amount: decimal("20"),
      blockNumber: BigInt(60_000_000),
      blockTimestamp: new Date(),
      network: "shasta" as const,
      confirmed,
      confirmationsRequired: 1,
    };
  }

  test("two accounts polling at once each see only their own deposit", async () => {
    const [alice, bob] = [await makeUser(), await makeUser()];
    const aliceAddress = await seedAssignedAddress(alice);
    const bobAddress = await seedAssignedAddress(bob);

    const forAlice = await recordObservedDeposit(transferTo(aliceAddress));
    const forBob = await recordObservedDeposit(transferTo(bobAddress));
    createdDeposits.push(forAlice.depositId, forBob.depositId);

    const aliceSees = await listDepositActivityForUser(alice);
    const bobSees = await listDepositActivityForUser(bob);

    assert.deepEqual(
      aliceSees.map((d) => d.id),
      [forAlice.depositId],
    );
    assert.deepEqual(
      bobSees.map((d) => d.id),
      [forBob.depositId],
    );
    assert.equal(aliceSees[0].status, "credited");
    assert.equal(aliceSees[0].amountUsdt, 20);
  });

  test("a transfer still waiting for its block shows for its own address's owner", async () => {
    // Nothing is attributed yet — `user_id` is null until the deposit is
    // confirmed and credited — so this is the `deposit_addresses` clause of the
    // read doing the work, and it must not reach anyone else.
    const [owner, stranger] = [await makeUser(), await makeUser()];
    const address = await seedAssignedAddress(owner);
    const strangerAddress = await seedAssignedAddress(stranger);
    void strangerAddress;

    const recorded = await recordObservedDeposit(transferTo(address, false));
    createdDeposits.push(recorded.depositId);

    const ownerSees = await listDepositActivityForUser(owner);
    assert.equal(ownerSees.length, 1);
    assert.equal(ownerSees[0].status, "confirming");
    assert.equal(ownerSees[0].userId, null, "seen, and deliberately not yet credited");

    assert.deepEqual(await listDepositActivityForUser(stranger), []);
  });

  test("checking repeatedly shows one deposit, not one per check", async () => {
    const user = await makeUser();
    const address = await seedAssignedAddress(user);
    const transfer = transferTo(address);

    // What three polls thirty seconds apart do to the same on-chain transfer.
    const first = await recordObservedDeposit(transfer);
    await recordObservedDeposit(transfer);
    await recordObservedDeposit(transfer);
    createdDeposits.push(first.depositId);

    const seen = await listDepositActivityForUser(user);
    assert.equal(seen.length, 1, "the unique index on (chain, tx_hash) is what guarantees this");
    assert.equal(seen[0].status, "credited");

    const ledger = await db
      .select({ amount: t.transactions.amount })
      .from(t.transactions)
      .where(eq(t.transactions.userId, user));
    assert.equal(ledger.length, 1, "and it is credited exactly once");
  });
});
