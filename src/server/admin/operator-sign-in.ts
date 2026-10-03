import "server-only";

import { eq, sql } from "drizzle-orm";

import * as t from "@/db/schema";
import { maskIndianMobile } from "@/lib/phone";
import { mutate, SYSTEM_ACTOR } from "@/server/write";

import {
  decideOperatorPhoneSignIn,
  OPERATOR_REFUSAL_MESSAGES,
} from "./operator-phone";
import { isAuthorizedAdminMobile } from "./access-gate";
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
    let [byPhone] = await tx
      .select(columns)
      .from(t.adminAgents)
      .where(eq(t.adminAgents.phoneE164, verified.phoneE164))
      .limit(1)
      .for("update");

    /*
     * FIRST MASTER-ADMIN SIGN-IN. The seeded master admin has no number, and
     * the decision below matches only on uid or number — so no verified
     * number could ever find it. When the deployment's own configuration
     * (ADMIN_LOGIN_MOBILE, already proven by the access code and the SMS)
     * authorises this number, adopt the one master admin that has neither a
     * number nor a uid. Exactly one, never a created row: two candidates is
     * ambiguity, and ambiguity is refused.
     */
    let adoptNumber = false;
    if (!byUid && !byPhone && isAuthorizedAdminMobile(verified.phoneE164)) {
      const candidates = await tx
        .select(columns)
        .from(t.adminAgents)
        .where(
          sql`${t.adminAgents.role} = 'master_admin' and ${t.adminAgents.phoneE164} is null and ${t.adminAgents.firebaseUid} is null`,
        )
        .limit(2)
        .for("update");
      if (candidates.length === 1) {
        byPhone = { ...candidates[0], phoneE164: verified.phoneE164 };
        adoptNumber = true;
      }
    }

    const decision = decideOperatorPhoneSignIn({
      uid: verified.uid,
      phoneE164: verified.phoneE164,
      byUid: byUid ?? null,
      byPhone: byPhone ?? null,
    });
    if (decision.action === "refuse") {
      /*
       * The access gate (environment) and the operator record (database) are
       * two separate authorisations, and both are needed. A number that passed
       * the gate but belongs to no operator row is told exactly that, so the
       * fix — a master admin adding it in Admin → Agents — is obvious.
       */
      if (decision.reason === "not_operator" && isAuthorizedAdminMobile(verified.phoneE164)) {
        throw new AdminAuthorizationError(
          "This number passed the access check but is not assigned to an operator account yet. A master admin must add it in Admin → Agents.",
        );
      }
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
          ? {
              firebaseUid: verified.uid,
              phoneVerifiedAt: now,
              ...(adoptNumber ? { phoneE164: verified.phoneE164 } : {}),
            }
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
