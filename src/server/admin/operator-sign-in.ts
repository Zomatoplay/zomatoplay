import "server-only";

import { eq, sql } from "drizzle-orm";

import * as t from "@/db/schema";
import { maskIndianMobile } from "@/lib/phone";
import { mutate, SYSTEM_ACTOR } from "@/server/write";

import {
  decideOperatorPhoneSignIn,
  OPERATOR_REFUSAL_MESSAGES,
} from "./operator-phone";
import { AdminAuthorizationError } from "./session";

/**
 * Carries out an operator sign-in for a phone that has just been verified
 * (`verifyPhoneProof`). The decision is `decideOperatorPhoneSignIn`; this reads
 * the rows it needs under `FOR UPDATE`, so two concurrent first sign-ins cannot
 * both bind, and the unique index on `firebase_uid` is the backstop.
 *
 * Returns what the session cookie needs. Grants nothing by itself: every later
 * request is resolved again by `getCurrentOperator`, and every action still
 * passes `requirePermission`.
 */
export async function signInOperatorByPhone(verified: {
  uid: string;
  phoneE164: string;
}): Promise<{ agentId: string; name: string; firebaseUid: string; sessionEpoch: number }> {
  return mutate(SYSTEM_ACTOR, async ({ tx, now, audit }) => {
    const columns = {
      id: t.adminAgents.id,
      name: t.adminAgents.name,
      status: t.adminAgents.status,
      firebaseUid: t.adminAgents.firebaseUid,
      phoneE164: t.adminAgents.phoneE164,
      sessionEpoch: t.adminAgents.sessionEpoch,
    };
    const [byUid] = await tx
      .select(columns)
      .from(t.adminAgents)
      .where(eq(t.adminAgents.firebaseUid, verified.uid))
      .limit(1)
      .for("update");
    const [byPhone] = await tx
      .select(columns)
      .from(t.adminAgents)
      .where(eq(t.adminAgents.phoneE164, verified.phoneE164))
      .limit(1)
      .for("update");

    const decision = decideOperatorPhoneSignIn({
      uid: verified.uid,
      phoneE164: verified.phoneE164,
      byUid: byUid ?? null,
      byPhone: byPhone ?? null,
    });
    if (decision.action === "refuse") {
      throw new AdminAuthorizationError(OPERATOR_REFUSAL_MESSAGES[decision.reason]);
    }

    const agent = decision.action === "use" ? byUid : byPhone;
    if (agent.status === "disabled") {
      throw new AdminAuthorizationError(
        "That operator account is disabled. Contact the master admin.",
      );
    }

    await tx
      .update(t.adminAgents)
      .set({
        ...(decision.action === "bind"
          ? { firebaseUid: verified.uid, phoneVerifiedAt: now }
          : {}),
        // An invitation is accepted by the first verified sign-in.
        status: sql`case when ${t.adminAgents.status} = 'invited' then 'active'::agent_status else ${t.adminAgents.status} end`,
        lastActiveAt: now,
      })
      .where(eq(t.adminAgents.id, agent.id));

    if (decision.action === "bind") {
      audit({
        action: "agent_updated",
        target: { type: "agent", id: agent.id, label: agent.name },
        details: `${agent.name} verified ${maskIndianMobile(verified.phoneE164)} by SMS and can now sign in.`,
      });
    }

    return {
      agentId: agent.id,
      name: agent.name,
      firebaseUid: verified.uid,
      sessionEpoch: agent.sessionEpoch,
    };
  });
}

/** Ends every session this operator holds, on every device. */
export async function endOperatorSessions(agentId: string): Promise<void> {
  await mutate(SYSTEM_ACTOR, async ({ tx }) => {
    await tx
      .update(t.adminAgents)
      .set({ sessionEpoch: sql`${t.adminAgents.sessionEpoch} + 1` })
      .where(eq(t.adminAgents.id, agentId));
  });
}
