import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq, inArray, like } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";

import {
  endCustomerSessions,
  ensureAccountForFirebasePrincipal,
  linkPhoneToAccount,
} from "./auth/account";
import { newId } from "./write";

/**
 * Phone sign-in against a real database: who a verified number reaches.
 *
 * The Firebase half (sending and checking the SMS) cannot run here; these
 * start from what the server has AFTER verifying a Firebase ID token — a uid
 * and an E.164 number — which is exactly the input the services accept.
 * Fixtures use `test-fb-` uids and are deleted in `after()`.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";
const UID_PREFIX = `test-fb-${Date.now().toString(36)}-`;

describe("phone sign-in: accounts, linking and sessions", { skip }, () => {
  let db: Database;
  const users: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    const created = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(like(t.users.firebaseUid, `${UID_PREFIX}%`));
    const ids = Array.from(new Set([...users, ...created.map((row) => row.id)]));
    if (ids.length > 0) {
      await db.delete(t.auditLogs).where(inArray(t.auditLogs.targetId, ids));
      await db.delete(t.users).where(inArray(t.users.id, ids));
    }
    await closeAdminDb(db);
    await closeDb();
  });

  function uid(tag: string) {
    return `${UID_PREFIX}${tag}`;
  }
  async function freshNumber(): Promise<string> {
    for (;;) {
      const candidate = `+91${randomInt(6, 10)}${String(randomInt(0, 1e9)).padStart(9, "0")}`;
      const [taken] = await db
        .select({ id: t.users.id })
        .from(t.users)
        .where(eq(t.users.phoneE164, candidate));
      if (!taken) return candidate;
    }
  }

  async function makeEmailUser(tag: string, balance: number) {
    const id = newId("usr_test");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      authUserId: null,
      displayId: `NT-P${suffix}`,
      fullName: `Legacy ${tag}`,
      email: `legacy-${suffix}@example.invalid`,
      phone: "+91 98765 43210",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      kycStatus: "verified",
      referralCode: `LEG${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    await db.insert(t.walletBalances).values({ userId: id, available: balance });
    users.push(id);
    return id;
  }

  async function row(id: string) {
    const [found] = await db.select().from(t.users).where(eq(t.users.id, id));
    return found;
  }

  test("a new verified number creates one account; signing in again reaches the same one", async () => {
    const phone = await freshNumber();
    const first = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("new"), phoneE164: phone });
    users.push(first.userId);
    const second = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("new"), phoneE164: phone });

    assert.equal(second.userId, first.userId, "no second account");
    const stored = await row(first.userId);
    assert.equal(stored.phoneE164, phone);
    assert.ok(stored.phoneVerifiedAt, "verified-phone state recorded");
    assert.equal(stored.email, null, "no invented email");
    assert.notEqual(stored.id, uid("new"), "the Firebase uid is not the account id");
  });

  test("a number already on another account is refused, never merged", async () => {
    const phone = await freshNumber();
    const owner = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("owner"), phoneE164: phone });
    users.push(owner.userId);

    await assert.rejects(
      ensureAccountForFirebasePrincipal({ firebaseUid: uid("impostor"), phoneE164: phone }),
      /already linked/,
    );
    const [impostor] = await db
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.firebaseUid, uid("impostor")));
    assert.equal(impostor, undefined, "no account was created for the second uid");
  });

  test("an unverified phone on an old account is never used to link", async () => {
    // The legacy account's typed `phone` equals the number, but it was never
    // verified: a phone sign-in must create a separate account, not adopt it.
    const legacy = await makeEmailUser("typed-phone", 250);
    const phone = await freshNumber();
    await db
      .update(t.users)
      .set({ phone: phone.replace("+91", "+91 ") })
      .where(eq(t.users.id, legacy));

    const account = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("typed"), phoneE164: phone });
    users.push(account.userId);
    assert.notEqual(account.userId, legacy);
    assert.equal((await row(legacy)).firebaseUid, null, "the old account is untouched");
  });

  test("linking an existing email customer keeps their account id and balance", async () => {
    const legacy = await makeEmailUser("linker", 1234.56789);
    const phone = await freshNumber();

    const { linked, account } = await linkPhoneToAccount({
      userId: legacy,
      firebaseUid: uid("linker"),
      phoneE164: phone,
    });
    assert.equal(linked, true);
    assert.equal(account.userId, legacy, "the same account, not a new empty one");

    const [wallet] = await db
      .select({ available: t.walletBalances.available })
      .from(t.walletBalances)
      .where(eq(t.walletBalances.userId, legacy));
    assert.equal(Number(wallet.available), 1234.56789, "balance unchanged");

    // From now on, phone sign-in reaches that same account.
    const again = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("linker"), phoneE164: phone });
    assert.equal(again.userId, legacy);
    const stored = await row(legacy);
    assert.ok(stored.email?.startsWith("legacy-"), "the email is kept");
  });

  test("an account already linked to one number cannot be re-linked to another", async () => {
    const legacy = await makeEmailUser("relink", 0);
    await linkPhoneToAccount({ userId: legacy, firebaseUid: uid("relink-a"), phoneE164: await freshNumber() });
    await assert.rejects(
      linkPhoneToAccount({ userId: legacy, firebaseUid: uid("relink-b"), phoneE164: await freshNumber() }),
      /already linked to a different mobile number/,
    );
  });

  test("signing out advances the session epoch the next request is checked against", async () => {
    const phone = await freshNumber();
    const account = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("epoch"), phoneE164: phone });
    users.push(account.userId);
    assert.equal(account.sessionEpoch, 0);

    await endCustomerSessions(account.userId);
    const after = await ensureAccountForFirebasePrincipal({ firebaseUid: uid("epoch"), phoneE164: phone });
    assert.equal(after.sessionEpoch, 1, "every session issued at epoch 0 is now refused");
  });
});
