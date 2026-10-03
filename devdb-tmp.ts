import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
import { eq, sql } from "drizzle-orm";
import { createAdminDb, closeAdminDb } from "./src/db";
import * as t from "./src/db/schema";
import { normalizeIndianMobile } from "./src/lib/phone";

(async () => {
  const db = createAdminDb();
  const [op, ...args] = process.argv.slice(2);
  const phone = normalizeIndianMobile(process.env.DEV_TEST_CUSTOMER_PHONE ?? "")!;
  const [u] = await db.select().from(t.users).where(eq(t.users.phoneE164, phone));
  if (op === "state") {
    const [w] = u ? await db.select().from(t.walletBalances).where(eq(t.walletBalances.userId, u.id)) : [];
    console.log(JSON.stringify(u ? { id: u.id, displayId: u.displayId, name: u.fullName, email: u.email, gender: u.gender, completed: u.profileCompletedAt, avatar: u.avatarStorageKey, kyc: u.kycStatus, available: w?.available } : null));
  } else if (op === "set") {
    const [col, val] = args;
    const map: Record<string, unknown> = { kyc: { kycStatus: val }, gender: { gender: val === "null" ? null : val }, email: { email: val === "null" ? null : val }, completed: { profileCompletedAt: val === "null" ? null : new Date(val) } };
    await db.update(t.users).set(map[col] as never).where(eq(t.users.id, u.id));
    console.log("ok");
  } else if (op === "agent") {
    const rows = await db.select({ id: t.adminAgents.id, role: t.adminAgents.role, status: t.adminAgents.status, phone: t.adminAgents.phoneE164, uid: t.adminAgents.firebaseUid }).from(t.adminAgents).where(eq(t.adminAgents.phoneE164, normalizeIndianMobile(args[0])!));
    console.log(JSON.stringify(rows));
  } else if (op === "delete-agent") {
    const id = (await db.select({ id: t.adminAgents.id }).from(t.adminAgents).where(eq(t.adminAgents.phoneE164, normalizeIndianMobile(args[0])!)))[0]?.id;
    if (id && id !== "agt_master") { await db.delete(t.adminAgentPermissions).where(eq(t.adminAgentPermissions.agentId, id)); await db.delete(t.adminAgents).where(eq(t.adminAgents.id, id)); }
    console.log("deleted", id ?? "none");
  } else if (op === "ledger") {
    const rows = await db.select({ amount: t.transactions.amount, type: t.transactions.type, d: t.transactions.description }).from(t.transactions).where(eq(t.transactions.userId, u.id)).orderBy(sql`occurred_at desc`).limit(3);
    const mc = await db.select({ dir: t.manualCredits.direction, amt: t.manualCredits.amountUsdt, after: t.manualCredits.balanceAfterUsdt, note: t.manualCredits.note }).from(t.manualCredits).where(eq(t.manualCredits.userId, u.id)).orderBy(sql`created_at desc`).limit(2);
    console.log(JSON.stringify({ ledger: rows, manual: mc }));
  } else if (op === "inv") {
    const rows = await db.select({ id: t.investments.id, d: t.investments.durationDays, v: t.investments.scheduleVersion, r: t.investments.appliedRatePercent, p: t.investments.projectedProfit, f: t.investments.rewardFrequency }).from(t.investments).where(eq(t.investments.userId, u.id)).orderBy(sql`created_at desc`).limit(1);
    console.log(JSON.stringify(rows));
  } else if (op === "kyccase") {
    const rows = await db.select({ id: t.kycSubmissions.id, flags: t.kycSubmissions.riskFlags, status: t.kycSubmissions.status }).from(t.kycSubmissions).where(eq(t.kycSubmissions.userId, u.id)).orderBy(sql`submitted_at desc`).limit(1);
    console.log(JSON.stringify(rows));
  }
  await closeAdminDb(db);
})();
