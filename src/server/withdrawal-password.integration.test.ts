import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";

import {
  checkWithdrawalPassword,
  createWithdrawalPassword,
  getWithdrawalPasswordState,
  resetWithdrawalPassword,
  WITHDRAWAL_PASSWORD_MAX_ATTEMPTS,
} from "./services/withdrawal-password.service";
import { newId, type Actor } from "./write";

/**
 * The withdrawal password against the real database: stored only as a hash,
 * checked with counted failures and a lock, and cleared only by an operator.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = { kind: "agent", id: "agt_wp_test", name: "WP Test Operator", role: "agent" };

describe("withdrawal password", { skip }, () => {
  let db: Database;
  const users: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of users) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.users).where(eq(t.users.id, id));
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_wp");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-W${suffix}`,
      fullName: "WP Test",
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      referralCode: `WP${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    users.push(id);
    return { id, actor: { kind: "user", id, name: "WP Test", role: "agent" } as Actor };
  }

  test("it is stored as a hash, never as the password", async () => {
    const { id, actor } = await makeUser();
    await createWithdrawalPassword({ userId: id, password: "Withdraw2026" }, actor);
    const [row] = await db.select().from(t.withdrawalPasswords).where(eq(t.withdrawalPasswords.userId, id));
    assert.ok(row.passwordHash.startsWith("scrypt$"));
    assert.ok(!row.passwordHash.includes("Withdraw2026"));
    assert.deepEqual(await getWithdrawalPasswordState(id), { isSet: true, lockedUntil: null });
  });

  test("the correct password passes; a wrong one is refused and counted", async () => {
    const { id, actor } = await makeUser();
    await createWithdrawalPassword({ userId: id, password: "Withdraw2026" }, actor);
    await checkWithdrawalPassword(id, "Withdraw2026", actor);
    await assert.rejects(checkWithdrawalPassword(id, "Wrong2026x", actor), {
      name: "WithdrawalPasswordError",
      message: /Incorrect withdrawal password\. 4 attempts left/,
    });
    const [row] = await db.select().from(t.withdrawalPasswords).where(eq(t.withdrawalPasswords.userId, id));
    assert.equal(row.failedAttempts, 1, "the failure survived the refused request");
    await checkWithdrawalPassword(id, "Withdraw2026", actor);
    const [reset] = await db.select().from(t.withdrawalPasswords).where(eq(t.withdrawalPasswords.userId, id));
    assert.equal(reset.failedAttempts, 0, "a correct password clears the count");
  });

  test("five wrong attempts lock withdrawals — even for the right password", async () => {
    const { id, actor } = await makeUser();
    await createWithdrawalPassword({ userId: id, password: "Withdraw2026" }, actor);
    for (let i = 0; i < WITHDRAWAL_PASSWORD_MAX_ATTEMPTS; i++) {
      await assert.rejects(checkWithdrawalPassword(id, `Wrong${i}abc1`, actor), { name: "WithdrawalPasswordError" });
    }
    await assert.rejects(checkWithdrawalPassword(id, "Withdraw2026", actor), {
      name: "WithdrawalPasswordError",
      message: /locked/,
    });
    const state = await getWithdrawalPasswordState(id);
    assert.equal(state.isSet, true);
    assert.ok(state.lockedUntil && Date.parse(state.lockedUntil) > Date.now());
  });

  test("a customer with no password is told to create one", async () => {
    const { id, actor } = await makeUser();
    await assert.rejects(checkWithdrawalPassword(id, "Anything123", actor), {
      name: "WithdrawalPasswordError",
      message: /Create a withdrawal password/,
    });
  });

  test("it cannot be replaced by setting it again — reset needs support", async () => {
    const { id, actor } = await makeUser();
    await createWithdrawalPassword({ userId: id, password: "Withdraw2026" }, actor);
    await assert.rejects(createWithdrawalPassword({ userId: id, password: "Another2026" }, actor), {
      name: "WithdrawalPasswordError",
      message: /already set.*contact support/i,
    });
    await checkWithdrawalPassword(id, "Withdraw2026", actor);
  });

  test("a customer cannot reset it; an operator can, with an audit entry", async () => {
    const { id, actor } = await makeUser();
    await createWithdrawalPassword({ userId: id, password: "Withdraw2026" }, actor);

    await assert.rejects(resetWithdrawalPassword({ userId: id, reason: "self" }, actor), {
      name: "WithdrawalPasswordError",
      message: /Only an operator/,
    });

    await resetWithdrawalPassword({ userId: id, reason: "identity confirmed on Telegram" }, OPERATOR);
    assert.deepEqual(await getWithdrawalPasswordState(id), { isSet: false, lockedUntil: null });
    const audits = await db
      .select()
      .from(t.auditLogs)
      .where(and(eq(t.auditLogs.targetId, id), eq(t.auditLogs.action, "withdrawal_password_reset")));
    assert.equal(audits.length, 1);
    assert.equal(audits[0].actorId, OPERATOR.id);
    assert.match(audits[0].details, /identity confirmed on Telegram/);

    // And the customer can now create a new one.
    await createWithdrawalPassword({ userId: id, password: "Fresh2026pw" }, actor);
    await checkWithdrawalPassword(id, "Fresh2026pw", actor);
  });
});
