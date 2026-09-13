import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

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
} from "./services/deposit-address.service";
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
    });
    createdAddressIds.push(id);
    return { id, address };
  }

  /**
   * Seeds a row already `assigned` to a user — for attribution tests, which
   * need an exact, known address-to-user mapping and no dependency on which
   * physical address the shared pool's claim mechanism happens to pick.
   */
  async function seedAssignedAddress(userId: string, target: PoolTarget = LIVE) {
    const id = newId("dpa_test");
    const address = fixtureAddress();
    const now = new Date();
    await db.insert(t.depositAddresses).values({
      id,
      userId,
      chain: target.chain,
      network: target.network,
      asset: target.asset,
      address,
      status: "assigned",
      assignedAt: now,
    });
    createdAddressIds.push(id);
    return { id, address };
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
      blockTimestamp: new Date(),
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
});
