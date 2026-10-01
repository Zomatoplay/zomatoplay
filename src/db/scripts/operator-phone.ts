import { randomBytes } from "node:crypto";

import { config as loadEnv } from "dotenv";
import { eq, or, sql } from "drizzle-orm";

import { maskIndianMobile, normalizeIndianMobile } from "../../lib/phone";
import { closeAdminDb, createAdminDb } from "../client";
import { isDatabaseConfigured } from "../env";
import * as t from "../schema";

/**
 * Sets the mobile number an operator signs in with.
 *
 *   npm run db:operator-phone -- --agent <agent id or work email> --phone <mobile>
 *   npm run db:operator-phone -- --list
 *
 * WHY A SCRIPT
 * ------------
 * Operators sign in by SMS, and a master admin sets each operator's number in
 * the CRM. The first master admin has nobody to do that for them — this is
 * that first step, run by whoever holds database access (on EC2, inside the
 * VPC). It is allowed in production for exactly that reason.
 *
 * What it does, in one transaction: writes `phone_e164`, clears any previous
 * Firebase binding, increments `session_epoch` (ending every session the
 * operator holds) and writes an audit entry under the System actor. The
 * operator then signs in at `/admin/login` with that number; the first
 * verified SMS binds it. Nothing here creates a credential.
 */

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  loadEnv({ path: ".env.local", quiet: true });
  loadEnv({ path: ".env", quiet: true });
  if (!isDatabaseConfigured()) {
    console.error("DATABASE_URL is not set.");
    process.exitCode = 1;
    return;
  }

  const db = createAdminDb();
  try {
    if (process.argv.includes("--list")) {
      const agents = await db
        .select({
          id: t.adminAgents.id,
          name: t.adminAgents.name,
          email: t.adminAgents.email,
          role: t.adminAgents.role,
          status: t.adminAgents.status,
          phone: t.adminAgents.phoneE164,
          bound: t.adminAgents.firebaseUid,
        })
        .from(t.adminAgents)
        .orderBy(t.adminAgents.createdAt);
      for (const agent of agents) {
        console.log(
          [
            agent.id.padEnd(22),
            agent.role.padEnd(12),
            agent.status.padEnd(9),
            (agent.phone ? maskIndianMobile(agent.phone) : "no number").padEnd(16),
            agent.bound ? "verified" : "         ",
            agent.email,
          ].join("  "),
        );
      }
      return;
    }

    const who = arg("agent")?.trim();
    const phone = normalizeIndianMobile(arg("phone") ?? "");
    if (!who || !phone) {
      console.error(
        "Usage: npm run db:operator-phone -- --agent <agent id or work email> --phone <10-digit Indian mobile>\n" +
          "       npm run db:operator-phone -- --list",
      );
      process.exitCode = 1;
      return;
    }

    const result = await db.transaction(async (tx) => {
      const [agent] = await tx
        .select({ id: t.adminAgents.id, name: t.adminAgents.name, status: t.adminAgents.status })
        .from(t.adminAgents)
        .where(or(eq(t.adminAgents.id, who), eq(t.adminAgents.email, who.toLowerCase())))
        .limit(1)
        .for("update");
      if (!agent) return null;

      await tx
        .update(t.adminAgents)
        .set({
          phoneE164: phone,
          firebaseUid: null,
          phoneVerifiedAt: null,
          sessionEpoch: sql`${t.adminAgents.sessionEpoch} + 1`,
        })
        .where(eq(t.adminAgents.id, agent.id));

      const now = new Date();
      await tx.insert(t.auditLogs).values({
        id: `aud_${now.getTime().toString(36)}${randomBytes(3).toString("hex")}`,
        actorId: "system",
        actorName: "System",
        actorRole: "master_admin",
        action: "agent_updated",
        targetType: "agent",
        targetId: agent.id,
        targetLabel: agent.name,
        createdAt: now,
        ipAddress: "0.0.0.0",
        outcome: "success",
        details: `Sign-in number set to ${maskIndianMobile(phone)} from the command line (db:operator-phone); sessions ended.`,
      });
      return agent;
    });

    if (!result) {
      console.error(`No operator matches "${who}". Run with --list to see them.`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `${result.name} (${result.id}, ${result.status}) can now sign in at /admin/login with ${maskIndianMobile(phone)}.`,
    );
    if (result.status === "disabled") {
      console.log("Note: this operator is disabled and will be refused until enabled.");
    }
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    console.error(
      /admin_agents_phone_e164_key/.test(text)
        ? "That number is already registered to another operator."
        : `Failed: ${text.split("\n")[0]}`,
    );
    process.exitCode = 1;
  } finally {
    await closeAdminDb(db);
  }
}

void main();
