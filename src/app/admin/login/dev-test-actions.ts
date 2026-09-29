"use server";

import { readCustomerSessionSecret } from "@/server/auth/customer-session";
import { issueDevChallenge, sameSecret, verifyDevChallenge } from "@/server/auth/dev-test-auth";
import { localTestOperator } from "@/server/auth/dev-test-gate";
import { createSupabaseServerClient } from "@/server/auth/session";
import { recordPipelineEvent } from "@/server/observability";
import { clientAddress, takeToken } from "@/server/rate-limit";

/**
 * LOCAL-ONLY operator test sign-in (`@/server/auth/dev-test-auth` explains the
 * gates).
 *
 * Replaces one step: the emailed code. On a match it signs in to Supabase *as
 * the real development operator* (`DEV_ADMIN_EMAIL` / `DEV_ADMIN_PASSWORD`,
 * server-side, never sent to the browser) and returns. The browser then calls
 * the ordinary `completeOperatorSignIn`, so whether this identity is an
 * operator, whether it is active and what it may do are answered by
 * `admin_agents` exactly as for anyone else. There is no operator this path can
 * produce that the real one could not.
 */

export interface LocalOperatorResult {
  ok: boolean;
  message: string;
  challenge?: string;
}

const UNAVAILABLE: LocalOperatorResult = { ok: false, message: "That sign-in method is not available." };
const LIMIT = { attempts: 20, windowMs: 10 * 60 * 1000 };

export async function startLocalTestOperatorAction(input: {
  email: string;
}): Promise<LocalOperatorResult> {
  const config = await localTestOperator();
  const secret = readCustomerSessionSecret();
  if (!config || !secret) return UNAVAILABLE;
  if (!(await allowed())) return tooMany();

  const email = String(input?.email ?? "").trim().toLowerCase();
  if (email !== config.email) {
    return { ok: false, message: "That is not the local test operator." };
  }
  return {
    ok: true,
    message: "Local test code ready.",
    challenge: issueDevChallenge(`operator:${email}`, secret, config.ttlSeconds),
  };
}

export async function completeLocalTestOperatorAction(input: {
  email: string;
  code: string;
  challenge: string;
}): Promise<LocalOperatorResult> {
  const config = await localTestOperator();
  const secret = readCustomerSessionSecret();
  if (!config || !secret) return UNAVAILABLE;
  if (!(await allowed())) return tooMany();

  const email = String(input?.email ?? "").trim().toLowerCase();
  if (
    email !== config.email ||
    !verifyDevChallenge(String(input?.challenge ?? ""), `operator:${email}`, secret) ||
    !sameSecret(String(input?.code ?? ""), config.code)
  ) {
    return { ok: false, message: "Invalid or expired code." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: config.email,
    password: config.password,
  });
  if (error) {
    // The dev credential itself is wrong or unconfirmed — say which variable
    // to look at, never the value.
    return {
      ok: false,
      message: "Supabase refused DEV_ADMIN_EMAIL / DEV_ADMIN_PASSWORD. Run npm run db:dev-accounts.",
    };
  }

  recordPipelineEvent({
    pipeline: "admin",
    operation: "admin.local_test_sign_in",
    status: "ok",
    message: "Operator credential established through the LOCAL test path (development build, localhost)",
  });
  return { ok: true, message: "Code accepted." };
}

async function allowed(): Promise<boolean> {
  const address = await clientAddress();
  return takeToken(`local-test-operator:${address}`, LIMIT.attempts, LIMIT.windowMs).allowed;
}

function tooMany(): LocalOperatorResult {
  return { ok: false, message: "Too many attempts. Please wait a few minutes and try again." };
}
