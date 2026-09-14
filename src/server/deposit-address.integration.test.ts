import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import { decimal, type Decimal } from "@/db/money";
import * as t from "@/db/schema";

import {
  AddressReleaseError,
  claimAvailableAddress,
  PoolExhaustedError,
  type PoolTarget,
} from "./repositories/deposit-address.repository";
import {
  getOrCreateDepositAddress,
  releaseDepositAddress,
  retireDepositAddress,
} from "./services/deposit-address.service";
import {
  IDLE_RELEASE_MS,
  SETTLED_RELEASE_MS,
} from "./services/deposit-address-policy";
import {
  releaseDecision,
  sweepDepositAddresses,
} from "./services/deposit-address-sweep.service";
import { recordObservedDeposit } from "./services/deposits.service";
import { getTronConfig } from "./tron/config";
import { mutate, newId, type Actor } from "./write";

/**
 * The deposit-address pool, against the real database.
 *
 * Two concerns, tested at the layer that actually decides each one:
 *
 *  - **Allocation** — `getOrCreateDepositAddress`, the real service, forced by
 *    `getTronConfig()` to operate on whichever network this environment is
 *    actually configured for. `LIVE` below is read from that config rather than
 *    named, so these tests follow a migration instead of being broken by one.
 *    Its pool is shared with whatever else uses this database, so these tests
 *    never assume *which* address gets handed out — only the properties that
 *    must hold regardless: the same user gets the same one back, two different
 *    users get two different ones, and nothing here ever hands one back to a
 *    browser-supplied identity.
 *
 *  - **Attribution and crediting** — `recordObservedDeposit`'s automatic-credit
 *    path. These tests seed a `deposit_addresses` row already `assigned`
 *    directly, rather than claiming through the pool, so they are exact and
 *    fully isolated from whatever else the shared pool contains.
 *
 * The pool-mechanics tests that genuinely need an empty pool to observe
 * exhaustion (and the network-scoping guarantee) run against `ISOLATED` —
 * whichever network is *not* the configured one — through the repository
 * functions directly, bypassing the service's config-match guard. The pool
 * sync only ever seeds the configured network, so nothing real can collide
 * with it, unlike `LIVE`, which the live scanner and real users share.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = {
  kind: "agent",
  id: "agt_test_deposit_pool",
  name: "Test Operator",
  role: "master_admin",
};

/**
 * The network this environment is actually configured for.
 *
 * Read from `getTronConfig()` rather than named, because
 * `getOrCreateDepositAddress` refuses any network but the configured one — a
 * deposit address on a chain nothing is scanning is an address nothing can
 * ever credit. Hard-coding `shasta` here is what broke every allocation test
 * the moment `TRON_NETWORK` became `mainnet`, and it would break them again
 * on the next migration.
 */
const LIVE: PoolTarget = {
  chain: "tron",
  network: getTronConfig().network,
  asset: "usdt",
};

/**
 * A network this environment is *not* configured for, used as a collision-free
 * namespace by the tests that need an empty pool (see the header). Derived the
 * same way and for the same reason: the property that matters is "not the live
 * one", not the word "nile".
 */
const ISOLATED: PoolTarget = {
  chain: "tron",
  network: LIVE.network === "nile" ? "shasta" : "nile",
  asset: "usdt",
};

describe("deposit address pool", { skip }, () => {
  let db: Database;
  const createdUsers: string[] = [];
  const createdAddressIds: string[] = [];
  const createdDeposits: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of createdUsers) {
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    for (const id of createdDeposits) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.deposits).where(eq(t.deposits.id, id));
    }
    for (const id of createdAddressIds) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.depositAddresses).where(eq(t.depositAddresses.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_test");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-D${suffix}`,
      fullName: "Deposit Pool Test",
      email: `deposit-pool-test-${suffix}@example.invalid`,
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `DPTEST${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id });
    createdUsers.push(id);
    return id;
  }

  function fixtureAddress() {
    return `TTEST${newId("addr").slice(-28).toUpperCase()}`;
  }

  /** Seeds one `available` pool row — for exercising the claim mechanism. */
  /**
   * Seeds an available address — dated 1970 on purpose.
   *
   * `claimAvailableAddress` hands out the *oldest* available row, and the
   * allocation tests below claim through the real service, which is pinned to
   * whichever network this environment is configured for. On a mainnet
   * deployment that pool is the production one: without this, a test claims
   * whichever real receiving address happens to be sitting in it and a
   * throwaway user walks off with it. That is not hypothetical — it happened,
   * to the live mainnet address, the first time this file was pointed at the
   * configured network instead of a hard-coded testnet.
   *
   * An epoch `createdAt` makes every seeded row unambiguously older than
   * anything real, so the claim tests can only ever take their own fixtures.
   * Tests that care about relative ordering set `createdAt` themselves
   * afterwards.
   */
  async function seedAvailableAddress(target: PoolTarget) {
    const id = newId("dpa_test");
    const address = fixtureAddress();
    await db.insert(t.depositAddresses).values({
      id,
      chain: target.chain,
      network: target.network,
      asset: target.asset,
      address,
      status: "available",
      createdAt: new Date(0),
    });
    createdAddressIds.push(id);
    return { id, address };
  }

  /**
   * Seeds a row already `assigned` to a user — for attribution tests, which
   * need an exact, known address-to-user mapping and no dependency on which
   * physical address the shared pool's claim mechanism happens to pick.
   */
  async function seedAssignedAddress(
    userId: string,
    target: PoolTarget = LIVE,
    options: { assignedAt?: Date } = {},
  ) {
    const id = newId("dpa_test");
    const address = fixtureAddress();
    const now = options.assignedAt ?? new Date();
    await db.insert(t.depositAddresses).values({
      id,
      userId,
      lastUserId: userId,
      chain: target.chain,
      network: target.network,
      asset: target.asset,
      address,
      status: "assigned",
      assignedAt: now,
    });
    /*
     * The open interval, exactly as `claimAvailableAddress` writes it.
     *
     * Attribution reads `deposit_address_assignments`, not
     * `deposit_addresses.user_id`, so a fixture that skipped this would be an
     * assignment no deposit could ever be matched to — and every attribution
     * test below would pass for the wrong reason, or fail for one.
     */
    await db.insert(t.depositAddressAssignments).values({
      id: newId("dpx_test"),
      addressId: id,
      address,
      chain: target.chain,
      network: target.network,
      asset: target.asset,
      userId,
      assignedAt: now,
    });
    createdAddressIds.push(id);
    return { id, address };
  }

  /**
   * Empties the isolated pool, so a test that asserts *which* address comes
   * back is asserting about its own fixture and nothing else.
   *
   * Integration test files share one live database (CLAUDE.md §16.7), and
   * every release in this file puts another row back into the pool — so a test
   * that claims and then checks an id is otherwise asserting a fact about the
   * physical table rather than a property it owns. Draining first makes the
   * claim deterministic.
   *
   * Only ever called on `ISOLATED`, which is a network this deployment does
   * not scan. Draining the live pool would hand production receiving addresses
   * to throwaway accounts.
   */
  async function drainPool(target: PoolTarget) {
    assert.notEqual(target.network, LIVE.network, "never drain the live pool");
    const sink = await makeUser();
    for (let i = 0; i < 50; i++) {
      try {
        await mutate(OPERATOR, ({ tx, now }) =>
          claimAvailableAddress(tx, sink, target, now),
        );
      } catch (error) {
        if (error instanceof PoolExhaustedError) return sink;
        throw error;
      }
    }
    throw new Error("the isolated pool did not drain — 50 addresses is not a fixture");
  }

  async function balanceOf(userId: string) {
    const [row] = await db
      .select({ available: t.walletBalances.available })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, userId));
    return row;
  }

  async function ledgerFor(userId: string) {
    return db
      .select({ reference: t.transactions.reference, amount: t.transactions.amount })
      .from(t.transactions)
      .where(eq(t.transactions.userId, userId));
  }

  function transferTo(
    address: string,
    overrides: Partial<{
      amount: Decimal;
      confirmed: boolean;
      network: PoolTarget["network"];
      txHash: string;
      /** When the block was produced — what attribution is decided from. */
      blockTimestamp: Date;
    }> = {},
  ) {
    return {
      txHash: overrides.txHash ?? `test-${newId("tx")}`,
      from: "TVj7RNVHy6thbM7BWdSe9G6gXwKhjhdNZS",
      to: address,
      contract: "TG3XXyExBkPp9nzdajDZsozEu4BkaSJozs",
      tokenSymbol: "USDT",
      amount: overrides.amount ?? decimal("10"),
      blockNumber: BigInt(60_000_000),
      blockTimestamp: overrides.blockTimestamp ?? new Date(),
      // The configured network by default, so a transfer lines up with the
      // addresses `seedAssignedAddress` writes. Ownership is scoped by network
      // as well as by address, so a mismatch here credits nobody — which is
      // exactly what test I asserts on purpose, and what every other test here
      // would have hit by accident.
      network: overrides.network ?? LIVE.network,
      confirmed: overrides.confirmed ?? true,
      confirmationsRequired: 1,
    };
  }

  /* --------------------------------------------------------- allocation -- */

  test("A — first-time allocation claims an address from the pool", async () => {
    await seedAvailableAddress(LIVE); // headroom — the shared pool may have its own
    const userId = await makeUser();

    const result = await getOrCreateDepositAddress(userId, LIVE.network, OPERATOR);

    assert.equal(result.status, "assigned");
    assert.ok(result.address.length > 0);

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.address, result.address));
    assert.equal(row.userId, userId);
    assert.equal(row.status, "assigned");
    assert.ok(row.assignedAt);
  });

  test("B — the same user gets the same address on a later request", async () => {
    await seedAvailableAddress(LIVE);
    const userId = await makeUser();

    const first = await getOrCreateDepositAddress(userId, LIVE.network, OPERATOR);
    const second = await getOrCreateDepositAddress(userId, LIVE.network, OPERATOR);

    assert.equal(first.address, second.address);

    const assigned = await db
      .select({ id: t.depositAddresses.id })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.userId, userId));
    assert.equal(assigned.length, 1, "only one address was ever claimed for this user");
  });

  test("C — two different users get two different addresses", async () => {
    await seedAvailableAddress(LIVE);
    await seedAvailableAddress(LIVE);
    const userA = await makeUser();
    const userB = await makeUser();

    const a = await getOrCreateDepositAddress(userA, LIVE.network, OPERATOR);
    const b = await getOrCreateDepositAddress(userB, LIVE.network, OPERATOR);

    assert.notEqual(a.address, b.address);
  });

  test("D — ownership is decided only by the userId the caller passes in, never inferred", async () => {
    /*
     * `getOrCreateDepositAddress(userId, network, actor)` takes `userId` as an
     * explicit argument from trusted server code — the server action resolves
     * it from the session (see `getMyDepositAddressAction`) and there is no
     * field in that action's input a browser-supplied payload could reach at
     * all. What this test can verify at this layer: two distinct ids, called
     * back to back, never see each other's allocation — an id is not a hint
     * the pool uses to guess with, it is the entire key.
     */
    await seedAvailableAddress(LIVE);
    await seedAvailableAddress(LIVE);
    const legitimateUser = await makeUser();
    const anotherUser = await makeUser();

    const legit = await getOrCreateDepositAddress(legitimateUser, LIVE.network, OPERATOR);
    const forgedAttempt = await getOrCreateDepositAddress(anotherUser, LIVE.network, OPERATOR);

    assert.notEqual(legit.address, forgedAttempt.address);

    const [legitRow] = await db
      .select({ userId: t.depositAddresses.userId })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.address, legit.address));
    assert.equal(legitRow?.userId, legitimateUser);
  });

  test("two concurrent first-time requests for the same user never claim two addresses", async () => {
    await seedAvailableAddress(LIVE);
    await seedAvailableAddress(LIVE);
    const userId = await makeUser();

    const [a, b] = await Promise.all([
      getOrCreateDepositAddress(userId, LIVE.network, OPERATOR),
      getOrCreateDepositAddress(userId, LIVE.network, OPERATOR),
    ]);

    assert.equal(a.address, b.address, "one user, one address, even racing");

    const assigned = await db
      .select({ id: t.depositAddresses.id })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.userId, userId));
    assert.equal(assigned.length, 1);
  });

  test("P — an address is never reassigned merely by asking again", async () => {
    await seedAvailableAddress(LIVE);
    const userId = await makeUser();

    const first = await getOrCreateDepositAddress(userId, LIVE.network, OPERATOR);
    // Nothing resembling "the page closed" or "the session ended" exists as an
    // input to this function — asking again, any number of times, later, is
    // the only thing being simulated, and it is a no-op on the assignment.
    for (let i = 0; i < 3; i += 1) {
      const again = await getOrCreateDepositAddress(userId, LIVE.network, OPERATOR);
      assert.equal(again.address, first.address);
    }

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.userId, userId));
    assert.equal(row.status, "assigned");
    assert.equal(row.releasedAt, null);
  });

  /* ------------------------------------------------- pool mechanics (nile) */

  test("pool exhaustion is refused loudly, not silently handed out twice", async () => {
    const userId = await makeUser();
    await assert.rejects(
      () => mutate(OPERATOR, ({ tx, now }) => claimAvailableAddress(tx, userId, ISOLATED, now)),
      PoolExhaustedError,
    );
  });

  test("claiming is scoped by network — an available address on one network is invisible to another", async () => {
    const liveSeed = await seedAvailableAddress(LIVE);
    const nileSeed = await seedAvailableAddress(ISOLATED);
    const userId = await makeUser();

    const claimed = await mutate(OPERATOR, ({ tx, now }) =>
      claimAvailableAddress(tx, userId, ISOLATED, now),
    );

    assert.equal(claimed.address, nileSeed.address);
    assert.notEqual(claimed.address, liveSeed.address);
  });

  /* --------------------------------------------------------- attribution -- */

  test("E — a transfer to a known, assigned address credits its owner automatically", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId);

    const { depositId } = await recordObservedDeposit(transferTo(address, { amount: decimal("20") }));
    createdDeposits.push(depositId);

    const [row] = await db.select().from(t.deposits).where(eq(t.deposits.id, depositId));
    assert.equal(row.userId, userId);
    assert.equal(row.status, "credited");
    assert.equal(row.assignedBy, "deposit-address-pool");

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("20"));
    const ledger = await ledgerFor(userId);
    assert.equal(ledger.length, 1);
    assert.equal(decimal(ledger[0].amount), decimal("20"));
  });

  test("F — a transfer to an unrecognised address credits nobody", async () => {
    const strangerAddress = fixtureAddress();
    const { depositId } = await recordObservedDeposit(transferTo(strangerAddress));
    createdDeposits.push(depositId);

    const [row] = await db.select().from(t.deposits).where(eq(t.deposits.id, depositId));
    assert.equal(row.userId, null);
    assert.equal(row.status, "confirmed", "recorded, awaiting an operator, never credited");
  });

  test("I — the same physical address on a different network resolves to nobody", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId, LIVE);

    // Same string, observed on a network this environment is not configured
    // for — ownership is scoped by network, not by address text alone.
    const { depositId } = await recordObservedDeposit(
      transferTo(address, { network: ISOLATED.network }),
    );
    createdDeposits.push(depositId);

    const [row] = await db.select().from(t.deposits).where(eq(t.deposits.id, depositId));
    assert.equal(row.userId, null);
  });

  test("K — an unconfirmed transfer to a known address is not credited yet", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId);

    const { depositId } = await recordObservedDeposit(transferTo(address, { confirmed: false }));
    createdDeposits.push(depositId);

    const [row] = await db.select().from(t.deposits).where(eq(t.deposits.id, depositId));
    assert.equal(row.status, "confirming");
    assert.equal(row.userId, null, "finality first — a re-org must not be able to take back a credit");
    assert.equal(decimal((await balanceOf(userId)).available), decimal("0"));
  });

  test("L — the exact blockchain amount is credited, not a rounded one", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId);

    const preciseAmount = decimal("123.45678901");
    const { depositId } = await recordObservedDeposit(transferTo(address, { amount: preciseAmount }));
    createdDeposits.push(depositId);

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), preciseAmount);
  });

  test("M — the same transaction hash is only ever credited once", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId);
    const txHash = `test-${newId("tx")}`;

    const first = await recordObservedDeposit(transferTo(address, { txHash, amount: decimal("15") }));
    const second = await recordObservedDeposit(transferTo(address, { txHash, amount: decimal("15") }));
    createdDeposits.push(first.depositId);

    assert.equal(first.depositId, second.depositId);

    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("15"), "one credit, not two");
    assert.equal((await ledgerFor(userId)).length, 1);
  });

  test("N — two concurrent scans of the same transfer credit exactly once", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId);
    const txHash = `test-${newId("tx")}`;

    const attempt = () => recordObservedDeposit(transferTo(address, { txHash, amount: decimal("9") }));
    const [a, b] = await Promise.all([attempt(), attempt()]);
    createdDeposits.push(a.depositId);

    assert.equal(a.depositId, b.depositId);
    const balance = await balanceOf(userId);
    assert.equal(decimal(balance.available), decimal("9"), "exactly one financial credit");
    assert.equal((await ledgerFor(userId)).length, 1);
  });

  test("O — the deposit record and the ledger entry agree on user, amount and reference", async () => {
    const userId = await makeUser();
    const { address } = await seedAssignedAddress(userId);
    const txHash = `test-${newId("tx")}`;

    const { depositId } = await recordObservedDeposit(transferTo(address, { txHash, amount: decimal("42.5") }));
    createdDeposits.push(depositId);

    const [deposit] = await db.select().from(t.deposits).where(eq(t.deposits.id, depositId));
    const ledger = await ledgerFor(userId);

    assert.equal(deposit.userId, userId);
    assert.equal(ledger.length, 1);
    assert.equal(ledger[0].reference, txHash);
    assert.equal(decimal(ledger[0].amount), decimal(deposit.amountUsdt));
    assert.ok(deposit.creditedAt);
  });

  /* ------------------------------------------------------------ release -- */

  test("Q — an address with unresolved deposit activity cannot be released", async () => {
    const userId = await makeUser();
    const { id: addressId, address } = await seedAssignedAddress(userId);

    // Unconfirmed — still awaiting finality, exactly the "unresolved
    // blockchain activity" the guard exists to catch. It has not been
    // credited to anyone yet, which is precisely why it must not be orphaned
    // by releasing the address it is pending against.
    const { depositId } = await recordObservedDeposit(transferTo(address, { confirmed: false }));
    createdDeposits.push(depositId);

    await assert.rejects(
      () => releaseDepositAddress({ addressId, reason: "test" }, OPERATOR),
      AddressReleaseError,
    );

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, addressId));
    assert.equal(row.status, "assigned", "still assigned — the release was refused");
  });

  test("an address with no unresolved activity releases back to the pool", async () => {
    const userId = await makeUser();
    const { id: addressId } = await seedAssignedAddress(userId);

    await releaseDepositAddress({ addressId, reason: "account closed, verified clean" }, OPERATOR);

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, addressId));
    assert.equal(row.status, "available");
    assert.equal(row.userId, null);
    assert.ok(row.releasedAt);
  });

  /* ------------------------------------------------------------- retire -- */

  test("R — an address with unresolved deposit activity cannot be retired either", async () => {
    const userId = await makeUser();
    const { id: addressId, address } = await seedAssignedAddress(userId);

    const { depositId } = await recordObservedDeposit(transferTo(address, { confirmed: false }));
    createdDeposits.push(depositId);

    await assert.rejects(
      () => retireDepositAddress({ addressId, reason: "test" }, OPERATOR),
      AddressReleaseError,
    );

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, addressId));
    assert.equal(row.status, "assigned", "still assigned — the retirement was refused");
  });

  test("retiring takes an address out of rotation without deleting it or its history", async () => {
    const userId = await makeUser();
    const { id: addressId, address } = await seedAssignedAddress(userId);

    await retireDepositAddress({ addressId, reason: "replaced by a new receiving address" }, OPERATOR);

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, addressId));

    assert.equal(row.status, "retired");
    assert.equal(row.address, address, "the row and its address survive — this is not a delete");
    assert.equal(row.userId, userId, "who held it is kept as history");
    assert.ok(row.assignedAt, "and from when");
    assert.ok(row.releasedAt, "with the moment it left rotation recorded");
  });

  /**
   * The whole reason this operation exists.
   *
   * Releasing the address being replaced returns it to `available`, and
   * `claimAvailableAddress` orders by `createdAt` — so the *older* address,
   * which is always the one being replaced, is handed straight back to the
   * next caller. Retiring has to leave the replacement as the only claimable
   * row even though it is newer.
   */
  test("a retired address is never claimed again, even when it is older than the replacement", async () => {
    /*
     * On ISOLATED, not LIVE — this test *claims* addresses, and the live pool
     * is shared with real users and the real scanner. Claiming out of it here
     * would hand a production address to a throwaway test account, which is
     * the exact accident this whole capability exists to undo.
     */
    /*
     * Drained first, so "the oldest available row" is a statement about this
     * test's own two fixtures rather than about whatever earlier tests in this
     * file have released back into the shared pool. Every release in this file
     * adds a row, so without this the assertion is about the physical table —
     * the hazard CLAUDE.md §16.7 names.
     */
    await drainPool(ISOLATED);

    const oldAddress = await seedAvailableAddress(ISOLATED);
    const replacement = await seedAvailableAddress(ISOLATED);

    // Pin both, so the ordering under test is the one asserted rather than
    // whatever `defaultNow()` produced microseconds apart: the address being
    // replaced is always the older of the two, which is what makes releasing
    // it hand it straight back.
    await db
      .update(t.depositAddresses)
      .set({ createdAt: new Date("2000-01-01T00:00:00.000Z") })
      .where(eq(t.depositAddresses.id, oldAddress.id));
    await db
      .update(t.depositAddresses)
      .set({ createdAt: new Date("2000-01-02T00:00:00.000Z") })
      .where(eq(t.depositAddresses.id, replacement.id));

    // Claim it, then retire it — the real sequence, not a shortcut into the
    // `retired` state.
    const holder = await makeUser();
    await mutate(OPERATOR, ({ tx, now }) => claimAvailableAddress(tx, holder, ISOLATED, now));
    const [claimedRow] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, oldAddress.id));
    assert.equal(claimedRow.status, "assigned", "the oldest available row is the one claimed");

    await retireDepositAddress({ addressId: oldAddress.id, reason: "rotated out" }, OPERATOR);

    const nextUser = await makeUser();
    const claimed = await mutate(OPERATOR, ({ tx, now }) =>
      claimAvailableAddress(tx, nextUser, ISOLATED, now),
    );

    assert.notEqual(
      claimed.address,
      oldAddress.address,
      "the retired address must never come back, however old it is",
    );
    assert.equal(
      claimed.address,
      replacement.address,
      "the next caller gets the replacement instead",
    );
  });

  test("retiring an already-retired address is refused rather than rewriting when it left", async () => {
    const userId = await makeUser();
    const { id: addressId } = await seedAssignedAddress(userId);

    await retireDepositAddress({ addressId, reason: "first" }, OPERATOR);
    const [first] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, addressId));

    await assert.rejects(
      () => retireDepositAddress({ addressId, reason: "second" }, OPERATOR),
      AddressReleaseError,
    );

    const [second] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, addressId));
    assert.deepEqual(second.releasedAt, first.releasedAt, "the original retirement time stands");
  });

  test("retiring is recorded in the audit trail", async () => {
    const userId = await makeUser();
    const { id: addressId, address } = await seedAssignedAddress(userId);

    await retireDepositAddress({ addressId, reason: "audit coverage" }, OPERATOR);

    const entries = await db
      .select()
      .from(t.auditLogs)
      .where(
        and(
          eq(t.auditLogs.actorId, OPERATOR.id),
          eq(t.auditLogs.action, "deposit_address_retired"),
        ),
      );
    const mine = entries.filter((entry) => entry.targetId === addressId);
    assert.equal(mine.length, 1, "exactly one entry, written in the retiring transaction");
    assert.equal(mine[0].targetLabel, address);
    assert.match(mine[0].details ?? "", /audit coverage/, "the operator's reason reaches the entry");
  });
  /* ---------------------------------------------------------------------- */
  /* Automatic release — the sweep                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * The whole point of these: an assignment used to be permanent, so a pool of
   * one or two addresses was permanently exhausted by the first one or two
   * people who opened the deposit screen and never paid. Releasing is the fix,
   * and releasing wrongly credits one customer's deposit to another — so every
   * boundary is asserted rather than assumed.
   */
  test("S — an assigned address with no deposit, older than the idle window, releases", async () => {
    const userId = await makeUser();
    const { id, address } = await seedAssignedAddress(userId, ISOLATED, {
      assignedAt: new Date(Date.now() - IDLE_RELEASE_MS - 60_000),
    });

    const summary = await sweepDepositAddresses();
    const mine = summary.outcomes.find((o) => o.addressId === id);

    assert.ok(mine, "the sweep considered this address");
    assert.equal(mine.released, true, mine.blockedBy ?? "");
    assert.equal(mine.reason, "idle_timeout");

    const [row] = await db
      .select()
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));
    assert.equal(row.status, "available");
    assert.equal(row.userId, null, "no longer belongs to anybody");
    assert.equal(row.lastUserId, userId, "but the row still says who held it");
    assert.ok(row.releasedAt, "when it was released is recorded");
    assert.ok(row.quarantineUntil, "and until when it is withheld from others");
    assert.ok(
      row.quarantineUntil.getTime() > Date.now(),
      "the quarantine is in the future",
    );

    // The interval is closed, which is what stops a later transfer being
    // attributed to the holder who has just let the address go.
    const [assignment] = await db
      .select()
      .from(t.depositAddressAssignments)
      .where(eq(t.depositAddressAssignments.addressId, id));
    assert.ok(assignment.releasedAt, "the assignment interval is closed");
    assert.equal(assignment.releaseReason, "idle_timeout");
    assert.equal(assignment.userId, userId, "and still says whose it was");
    void address;
  });

  test("T — an assigned address younger than the idle window stays assigned", async () => {
    const userId = await makeUser();
    const { id } = await seedAssignedAddress(userId, ISOLATED, {
      assignedAt: new Date(Date.now() - 30_000),
    });

    const summary = await sweepDepositAddresses();
    assert.equal(
      summary.outcomes.some((o) => o.addressId === id),
      false,
      "too young to even be a candidate",
    );

    const [row] = await db
      .select({ status: t.depositAddresses.status, userId: t.depositAddresses.userId })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));
    assert.equal(row.status, "assigned");
    assert.equal(row.userId, userId);
  });

  test("U — an unresolved deposit protects the address at any age", async () => {
    const userId = await makeUser();
    // Old enough that the idle window has long passed — the only thing keeping
    // it is the deposit.
    const { id, address } = await seedAssignedAddress(userId, ISOLATED, {
      assignedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000),
    });

    const depositId = newId("dep_test");
    await db.insert(t.deposits).values({
      id: depositId,
      userId: null,
      amountUsdt: 12.5,
      chain: "tron",
      chainNetwork: ISOLATED.network,
      network: "trc20",
      walletAddress: address,
      txHash: `0xsweep${depositId}`,
      status: "confirmed",
      confirmationsRequired: 1,
      detectedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdDeposits.push(depositId);

    const summary = await sweepDepositAddresses();
    const mine = summary.outcomes.find((o) => o.addressId === id);
    assert.ok(mine, "it was considered");
    assert.equal(mine.released, false);
    assert.match(mine.blockedBy ?? "", /unresolved/i);

    const [row] = await db
      .select({ status: t.depositAddresses.status })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));
    assert.equal(row.status, "assigned", "still protected");
  });

  test("V — an address whose deposits have all settled waits out the settle window", async () => {
    const userId = await makeUser();
    const { id, address } = await seedAssignedAddress(userId, ISOLATED, {
      assignedAt: new Date(Date.now() - 30 * 24 * 60 * 60_000),
    });

    // A credited deposit, updated just now: terminal, but recent.
    const depositId = newId("dep_test");
    await db.insert(t.deposits).values({
      id: depositId,
      userId,
      amountUsdt: 5,
      chain: "tron",
      chainNetwork: ISOLATED.network,
      network: "trc20",
      walletAddress: address,
      txHash: `0xsettled${depositId}`,
      status: "credited",
      confirmationsRequired: 1,
      detectedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    createdDeposits.push(depositId);

    const held = await sweepDepositAddresses();
    const blocked = held.outcomes.find((o) => o.addressId === id);
    assert.ok(blocked);
    assert.equal(blocked.released, false, "a fresh credit is not a finished customer");
    assert.match(blocked.blockedBy ?? "", /settle window/);

    // Age the deposit past the settle window and it becomes releasable — the
    // post-credit rule, which is the other half of the lifecycle.
    await db
      .update(t.deposits)
      .set({ updatedAt: new Date(Date.now() - SETTLED_RELEASE_MS - 60_000) })
      .where(eq(t.deposits.id, depositId));

    const freed = await sweepDepositAddresses();
    const released = freed.outcomes.find((o) => o.addressId === id);
    assert.ok(released);
    assert.equal(released.released, true, released.blockedBy ?? "");
    assert.equal(released.reason, "settled");
  });

  test("W — re-running the sweep is idempotent", async () => {
    const userId = await makeUser();
    const { id } = await seedAssignedAddress(userId, ISOLATED, {
      assignedAt: new Date(Date.now() - IDLE_RELEASE_MS - 60_000),
    });

    await sweepDepositAddresses();
    const [first] = await db
      .select({ releasedAt: t.depositAddresses.releasedAt })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));

    // A second pass must not touch an address it already released — a moving
    // `released_at` would keep extending the quarantine and would rewrite when
    // the address actually changed hands.
    await sweepDepositAddresses();
    const [second] = await db
      .select({
        releasedAt: t.depositAddresses.releasedAt,
        status: t.depositAddresses.status,
      })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));

    assert.equal(second.status, "available");
    assert.equal(
      second.releasedAt?.getTime(),
      first.releasedAt?.getTime(),
      "the release instant is not rewritten",
    );

    const intervals = await db
      .select()
      .from(t.depositAddressAssignments)
      .where(eq(t.depositAddressAssignments.addressId, id));
    assert.equal(intervals.length, 1, "no second interval was invented");
  });

  test("X — inside the quarantine only the previous holder may take it back", async () => {
    await drainPool(ISOLATED);

    const first = await makeUser();
    const { id } = await seedAssignedAddress(first, ISOLATED, {
      assignedAt: new Date(Date.now() - IDLE_RELEASE_MS - 60_000),
    });
    await sweepDepositAddresses();

    // Inside the quarantine, a *different* user is passed over. With the pool
    // otherwise empty that is an exhaustion, which is the strongest available
    // statement of "this row was not offered to them".
    const stranger = await makeUser();
    await assert.rejects(
      mutate(OPERATOR, ({ tx, now }) =>
        claimAvailableAddress(tx, stranger, ISOLATED, now),
      ),
      PoolExhaustedError,
      "a stranger cannot take a just-released address",
    );

    // The previous holder can, immediately — there is no attribution risk in
    // giving somebody back their own address.
    const reclaimed = await mutate(OPERATOR, ({ tx, now }) =>
      claimAvailableAddress(tx, first, ISOLATED, now),
    );
    assert.equal(reclaimed.id, id);
    assert.equal(reclaimed.userId, first);
    assert.equal(reclaimed.quarantineUntil, null, "cleared once held again");

    const intervals = await db
      .select()
      .from(t.depositAddressAssignments)
      .where(eq(t.depositAddressAssignments.addressId, id));
    assert.equal(intervals.length, 2, "the second assignment opened its own interval");
  });

  test("Y — a stranger may claim it once the quarantine has elapsed", async () => {
    await drainPool(ISOLATED);

    const first = await makeUser();
    const { id } = await seedAssignedAddress(first, ISOLATED, {
      assignedAt: new Date(Date.now() - IDLE_RELEASE_MS - 60_000),
    });
    await sweepDepositAddresses();

    // Expire the quarantine rather than waiting a day for it.
    await db
      .update(t.depositAddresses)
      .set({ quarantineUntil: new Date(Date.now() - 1_000) })
      .where(eq(t.depositAddresses.id, id));

    const stranger = await makeUser();
    const claimed = await mutate(OPERATOR, ({ tx, now }) =>
      claimAvailableAddress(tx, stranger, ISOLATED, now),
    );
    assert.equal(claimed.id, id);
    assert.equal(claimed.userId, stranger);
  });

  /* ---------------------------------------------------------------------- */
  /* Attribution across a change of holder                                   */
  /* ---------------------------------------------------------------------- */

  test("Z — a late transfer is credited to whoever held the address when it was SENT", async () => {
    /*
     * THE TEST THIS WHOLE DESIGN EXISTS FOR.
     *
     * Releasing an address is only safe if a transfer that arrives afterwards
     * still belongs to the person who was shown it. Attribution by *current*
     * holder — which is what the code did before — would credit this deposit
     * to the second user, which is one customer's money in another customer's
     * wallet with nothing on-chain to indicate anything went wrong.
     */
    const first = await makeUser();
    const second = await makeUser();
    const { id, address } = await seedAssignedAddress(first, LIVE, {
      assignedAt: new Date(Date.now() - IDLE_RELEASE_MS - 120_000),
    });

    // The transfer is sent while `first` holds the address …
    const sentAt = new Date(Date.now() - 90_000);

    /*
     * … then the address is released and handed to somebody else.
     *
     * The hand-over is written directly rather than claimed through the pool.
     * This test has to run on `LIVE` — `recordObservedDeposit` resolves
     * ownership on the configured network and nothing else — and the live pool
     * is shared with real users, so draining it to make a claim deterministic
     * is exactly the accident this capability exists to undo. What is under
     * test here is attribution across a change of holder, not the claim
     * mechanism; the claim mechanism has tests X and Y of its own.
     */
    await sweepDepositAddresses();
    const handoverAt = new Date();
    await db
      .update(t.depositAddresses)
      .set({
        userId: second,
        lastUserId: second,
        status: "assigned",
        assignedAt: handoverAt,
        quarantineUntil: null,
      })
      .where(eq(t.depositAddresses.id, id));
    await db.insert(t.depositAddressAssignments).values({
      id: newId("dpx_test"),
      addressId: id,
      address,
      chain: LIVE.chain,
      network: LIVE.network,
      asset: LIVE.asset,
      userId: second,
      assignedAt: handoverAt,
    });

    const [handed] = await db
      .select({ userId: t.depositAddresses.userId })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));
    assert.equal(handed.userId, second, "the fixture address really did change hands");

    // Only now does the scanner see the transfer.
    const result = await recordObservedDeposit(
      transferTo(address, { blockTimestamp: sentAt }),
    );
    createdDeposits.push(result.depositId);

    const [deposit] = await db
      .select({ userId: t.deposits.userId, status: t.deposits.status })
      .from(t.deposits)
      .where(eq(t.deposits.id, result.depositId));

    assert.equal(deposit.userId, first, "credited to the sender's holder, not the current one");
    assert.equal(deposit.status, "credited");

    const strangerLedger = await ledgerFor(second);
    assert.equal(strangerLedger.length, 0, "the new holder was credited nothing");
  });

  test("AA — a transfer arriving while nobody held the address credits nobody", async () => {
    const userId = await makeUser();
    const { id, address } = await seedAssignedAddress(userId, LIVE, {
      assignedAt: new Date(Date.now() - IDLE_RELEASE_MS - 120_000),
    });
    await sweepDepositAddresses();

    const [row] = await db
      .select({ status: t.depositAddresses.status })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));
    assert.equal(row.status, "available", "released, so nobody holds it");

    // Sent *after* the release: it falls in the gap.
    const result = await recordObservedDeposit(
      transferTo(address, { blockTimestamp: new Date(Date.now() + 1_000) }),
    );
    createdDeposits.push(result.depositId);

    const [deposit] = await db
      .select({ userId: t.deposits.userId, status: t.deposits.status })
      .from(t.deposits)
      .where(eq(t.deposits.id, result.depositId));

    // Unattributed and visible, for an operator to assign by hand. Slow and
    // correct beats fast and wrong — CLAUDE.md §18.4.
    assert.equal(deposit.userId, null);
    assert.equal(deposit.status, "confirmed");
    assert.equal((await ledgerFor(userId)).length, 0);
  });

  /* ---------------------------------------------------------------------- */
  /* Manual release                                                          */
  /* ---------------------------------------------------------------------- */

  test("AB — an operator may release a safe address at any age", async () => {
    /*
     * The idle and settle windows govern the *sweep*, not an operator's
     * authority. An operator has looked at the address and decided; refusing
     * them because it was assigned four minutes ago would be inventing a rule
     * the write path does not have.
     */
    const userId = await makeUser();
    const { id, address } = await seedAssignedAddress(userId, ISOLATED);

    const released = await releaseDepositAddress(
      { addressId: id, reason: "operator release, fresh assignment" },
      OPERATOR,
    );
    assert.equal(released.address, address, "the action names what it changed");

    const [row] = await db
      .select({ status: t.depositAddresses.status, userId: t.depositAddresses.userId })
      .from(t.depositAddresses)
      .where(eq(t.depositAddresses.id, id));
    assert.equal(row.status, "available");
    assert.equal(row.userId, null);

    const [assignment] = await db
      .select({ releaseReason: t.depositAddressAssignments.releaseReason })
      .from(t.depositAddressAssignments)
      .where(eq(t.depositAddressAssignments.addressId, id));
    assert.equal(assignment.releaseReason, "operator");
  });

  test("AC — two concurrent releases: exactly one succeeds", async () => {
    const userId = await makeUser();
    const { id } = await seedAssignedAddress(userId, ISOLATED);

    const results = await Promise.allSettled([
      releaseDepositAddress({ addressId: id, reason: "race A" }, OPERATOR),
      releaseDepositAddress({ addressId: id, reason: "race B" }, OPERATOR),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    assert.equal(fulfilled.length, 1, "exactly one release won");

    const rejected = results.find((r) => r.status === "rejected");
    assert.ok(rejected);
    assert.ok(
      rejected.reason instanceof AddressReleaseError,
      "the loser is refused with a clear reason, not a driver error",
    );

    const intervals = await db
      .select()
      .from(t.depositAddressAssignments)
      .where(eq(t.depositAddressAssignments.addressId, id));
    assert.equal(intervals.length, 1);
    assert.ok(intervals[0].releasedAt, "closed exactly once");
  });

  test("AD — releasing something that is not assigned says so", async () => {
    const { id } = await seedAvailableAddress(ISOLATED);
    await assert.rejects(
      releaseDepositAddress({ addressId: id, reason: "nothing to release" }, OPERATOR),
      (error: Error) => {
        assert.ok(error instanceof AddressReleaseError);
        assert.match(error.message, /available/, "the real state is named");
        return true;
      },
    );
  });

  /* ---------------------------------------------------------------------- */
  /* The decision function, at its boundaries                                */
  /* ---------------------------------------------------------------------- */

  test("AE — unresolved activity refuses first, whatever the clock says", () => {
    // Order matters: no amount of elapsed time may talk the sweep past a
    // deposit nobody has finished dealing with.
    const ancient = new Date(Date.now() - 365 * 24 * 60 * 60_000);
    const decision = releaseDecision(
      {
        assignedAt: ancient,
        lastDepositAt: ancient,
        depositCount: 1,
        unresolvedDeposits: 1,
      },
      new Date(),
    );
    assert.equal(decision.release, false);
    assert.match(decision.blockedBy, /unresolved/);
  });

  test("AF — the idle boundary is inclusive, and a millisecond short is not", () => {
    const now = new Date();
    const exactly = {
      assignedAt: new Date(now.getTime() - IDLE_RELEASE_MS),
      lastDepositAt: null,
      depositCount: 0,
      unresolvedDeposits: 0,
    };
    assert.equal(releaseDecision(exactly, now).release, true);

    const short = {
      ...exactly,
      assignedAt: new Date(now.getTime() - IDLE_RELEASE_MS + 1),
    };
    assert.equal(releaseDecision(short, now).release, false);
  });

  test("AG — an assignment with no timestamp is never aged out", () => {
    /*
     * The same refusal the commission release makes for a null `release_at`
     * (CLAUDE.md §10): nothing here invents the date on which somebody's
     * address becomes somebody else's.
     */
    const decision = releaseDecision(
      {
        assignedAt: null,
        lastDepositAt: null,
        depositCount: 0,
        unresolvedDeposits: 0,
      },
      new Date(),
    );
    assert.equal(decision.release, false);
    assert.match(decision.blockedBy, /timestamp/);
  });
});
