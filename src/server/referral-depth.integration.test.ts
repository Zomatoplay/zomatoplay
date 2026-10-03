import assert from "node:assert/strict";
import { after, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";

import { listReferralNetwork } from "./repositories/referrals.repository";
import { newId } from "./write";

/**
 * VIP level = referral depth from the viewer (A → B → C → D), against the real
 * database. Everything runs in one transaction that is rolled back, so no
 * account is left behind.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

class Rollback extends Error {}

describe("referral VIP depth", { skip }, () => {
  const db = isDatabaseConfigured() ? createAdminDb() : null;

  after(async () => {
    if (db) await closeAdminDb(db);
    await closeDb();
  });

  test("A sees B/C/D as VIP 1/2/3, B sees C/D as 1/2, C sees D as 1; many directs stay VIP 1", async () => {
    try {
      await db!.transaction(async (tx) => {
        const codes: Record<string, string> = {};
        const ids: Record<string, string> = {};
        async function user(name: string, referredBy: string | null) {
          const id = newId("usr_vd");
          const code = `VD${id.slice(-8)}${name}`.toUpperCase();
          ids[name] = id;
          codes[name] = code;
          await tx.insert(t.users).values({
            id,
            displayId: `NT-V${id.slice(-9)}`,
            fullName: `Depth ${name}`,
            phone: "+91 00000 00000",
            registeredAt: new Date(),
            lastActiveAt: new Date(),
            referralCode: code,
            referredByCode: referredBy ? codes[referredBy] : null,
            walletAddress: `T${id.slice(-12)}`,
          });
        }
        await user("A", null);
        await user("B", "A");
        await user("C", "B");
        await user("D", "C");
        // Four more direct referrals of A: still VIP 1, however many there are.
        for (const extra of ["E", "F", "G", "H"]) await user(extra, "A");

        const depthOf = async (viewer: string) =>
          Object.fromEntries(
            (await listReferralNetwork(tx, ids[viewer])).map((r) => [r.name.replace("Depth ", ""), r.depth]),
          );

        assert.deepEqual(await depthOf("A"), { B: 1, E: 1, F: 1, G: 1, H: 1, C: 2, D: 3 });
        assert.deepEqual(await depthOf("B"), { C: 1, D: 2 });
        assert.deepEqual(await depthOf("C"), { D: 1 });
        assert.deepEqual(await depthOf("D"), {});
        throw new Rollback();
      });
    } catch (error) {
      if (!(error instanceof Rollback)) throw error;
    }
  });
});
