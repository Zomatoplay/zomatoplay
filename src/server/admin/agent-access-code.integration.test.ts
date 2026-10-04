import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";
import { hashPassword } from "@/server/auth/password-hash";

import { accessCodeAccepted, agentAccessCodeMatches } from "./access-gate";

/**
 * The normal multi-admin path: an operator's own access code lives (hashed)
 * on their `admin_agents` row, so adding an administrator needs no
 * environment variable. Uses throwaway rows with numbers no real operator has.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

describe("per-operator access codes", { skip }, () => {
  let db: Database;
  const ACTIVE = "+919555500101";
  const DISABLED = "+919555500102";
  const NO_CODE = "+919555500103";
  const ids = ["agt_codetest_a", "agt_codetest_d", "agt_codetest_n"];

  before(async () => {
    db = createAdminDb();
    const hash = await hashPassword("AgentCode7");
    const base = { role: "agent" as const, createdAt: new Date() };
    await db.insert(t.adminAgents).values([
      { ...base, id: ids[0], name: "Code A", email: "code-a@test.invalid", status: "invited", phoneE164: ACTIVE, accessCodeHash: hash },
      { ...base, id: ids[1], name: "Code D", email: "code-d@test.invalid", status: "disabled", phoneE164: DISABLED, accessCodeHash: hash },
      { ...base, id: ids[2], name: "Code N", email: "code-n@test.invalid", status: "active", phoneE164: NO_CODE },
    ]);
  });

  after(async () => {
    for (const id of ids) await db.delete(t.adminAgents).where(eq(t.adminAgents.id, id));
    await closeAdminDb(db);
    await closeDb();
  });

  test("the operator's own code opens the gate for their number only", async () => {
    assert.equal(await agentAccessCodeMatches(ACTIVE, "AgentCode7"), true);
    assert.equal(await agentAccessCodeMatches(ACTIVE, " AgentCode7 "), true);
    assert.equal(await agentAccessCodeMatches(ACTIVE, "agentcode7"), false);
    assert.equal(await agentAccessCodeMatches(ACTIVE, "AgentCode8"), false);
    assert.equal(await agentAccessCodeMatches("+919555500199", "AgentCode7"), false);
    assert.equal(await agentAccessCodeMatches(null, "AgentCode7"), false);
  });

  test("a disabled operator, or one with no code set, never passes", async () => {
    assert.equal(await agentAccessCodeMatches(DISABLED, "AgentCode7"), false);
    assert.equal(await agentAccessCodeMatches(NO_CODE, "AgentCode7"), false);
  });

  test("no environment variable is needed for an operator with a code", async () => {
    const saved = { ...process.env };
    delete process.env.ADMIN_LOGIN_ACCOUNTS;
    delete process.env.ADMIN_LOGIN_MOBILE;
    delete process.env.ADMIN_LOGIN_ACCESS_CODE;
    try {
      assert.equal(await accessCodeAccepted(ACTIVE, "AgentCode7"), true);
      assert.equal(await accessCodeAccepted(NO_CODE, "AgentCode7"), false);
    } finally {
      Object.assign(process.env, saved);
    }
  });

  test("the hash is stored, never the code", async () => {
    const [row] = await db.select().from(t.adminAgents).where(eq(t.adminAgents.id, ids[0]));
    assert.ok(row.accessCodeHash?.startsWith("scrypt$"));
    assert.ok(!row.accessCodeHash?.includes("AgentCode7"));
  });
});
