import "server-only";

import { createHmac } from "node:crypto";

import { and, eq, isNotNull, ne } from "drizzle-orm";
import { cookies } from "next/headers";

import { getDb } from "@/db";
import * as t from "@/db/schema";
import { normalizeIndianMobile } from "@/lib/phone";
import { hashPassword, verifyPassword } from "@/server/auth/password-hash";
import { sameSecret } from "@/server/auth/dev-test-auth";

import { readOperatorSessionSecret } from "./operator-session";

/**
 * The administrator access gate — a second factor asked BEFORE any SMS is sent.
 *
 * TWO SOURCES OF CODES (2026-10)
 * ------------------------------
 *   admin_agents.access_code_hash   THE NORMAL PATH. Each operator's own code,
 *                                   set by a master admin in Admin → Agents,
 *                                   stored as a scrypt hash. Adding an
 *                                   administrator needs no environment change
 *                                   and no restart: create the agent with a
 *                                   number and a code, and that is all.
 *   the environment (below)         The bootstrap: how the FIRST master admin
 *                                   gets in before any row has a code, and a
 *                                   break-glass path. Still honoured.
 *
 * A disabled operator's code never opens the gate. Either source passing
 * authorises nobody by itself (see below).
 *
 *   ADMIN_LOGIN_ACCOUNTS      one entry per administrator, each with their
 *                              OWN code: "mobile:code,mobile:code". Numbers in
 *                              any Indian spelling; codes exactly 10 letters
 *                              and digits (so ':' and ',' can never be part of
 *                              one).
 *   ADMIN_LOGIN_MOBILE +       the original single-code form, still honoured:
 *   ADMIN_LOGIN_ACCESS_CODE    every number in ADMIN_LOGIN_MOBILE shares the
 *                              one ADMIN_LOGIN_ACCESS_CODE.
 *
 * The two forms merge. A number listed twice with different codes is
 * ambiguous and is dropped entirely rather than accepting either code. A
 * malformed entry is ignored, never half-accepted. The values are read on
 * every call, so adding or removing an administrator needs only the
 * environment changed and the process restarted — no deployment.
 *
 * Passing the gate authorises nobody by itself: after the SMS code the number
 * must still resolve to an `admin_agents` row (`signInOperatorByPhone`).
 *
 * Both are server-only environment values: never `NEXT_PUBLIC_`, never stored,
 * never logged, never returned. It does not replace the SMS code — Firebase
 * still proves control of the number — and it fails CLOSED: with either value
 * missing or malformed, operator sign-in is refused rather than left open.
 *
 * WHY A PASS COOKIE AS WELL
 * -------------------------
 * Firebase sends the SMS from the browser, so the server cannot physically stop
 * a script calling Firebase directly. What it can do is refuse to turn the
 * resulting proof into a session: a correct access code mints a short-lived,
 * signed, httpOnly pass bound to that number, and
 * `completeOperatorPhoneSignIn` requires it. Knowing a number is not enough.
 */

const CODE_SHAPE = /^[A-Za-z0-9]{10}$/;
export const ACCESS_PASS_COOKIE = "nanotron-operator-gate";
const PASS_SECONDS = 15 * 60;

/** Every authorised number and its code, from both forms. Read per call. */
function configuredAccounts(): Map<string, string> {
  const entries: [string, string][] = [];

  for (const raw of (process.env.ADMIN_LOGIN_ACCOUNTS ?? "").split(",")) {
    const separator = raw.lastIndexOf(":");
    if (separator <= 0) continue;
    const phone = normalizeIndianMobile(raw.slice(0, separator));
    const code = raw.slice(separator + 1).trim();
    if (phone && CODE_SHAPE.test(code)) entries.push([phone, code]);
  }

  const sharedCode = (process.env.ADMIN_LOGIN_ACCESS_CODE ?? "").trim();
  if (CODE_SHAPE.test(sharedCode)) {
    for (const raw of (process.env.ADMIN_LOGIN_MOBILE ?? "").split(",")) {
      const phone = normalizeIndianMobile(raw);
      if (phone) entries.push([phone, sharedCode]);
    }
  }

  const accounts = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [phone, code] of entries) {
    const existing = accounts.get(phone);
    if (existing !== undefined && existing !== code) ambiguous.add(phone);
    accounts.set(phone, code);
  }
  for (const phone of ambiguous) accounts.delete(phone);
  return accounts;
}

/*
 * Verified against when no operator row matches, so "no such number" costs the
 * same scrypt time as "wrong code" and timing does not reveal which numbers
 * are operators.
 */
let dummyHash: Promise<string> | null = null;
function timingDecoy(): Promise<string> {
  dummyHash ??= hashPassword("decoy-access-code");
  return dummyHash;
}

/**
 * Does an operator who is not disabled hold this number with this access
 * code? One indexed lookup on the unique `phone_e164`, then a constant-time
 * scrypt comparison. Throws only when the database cannot be reached — the
 * caller reports that as retryable, never as a refusal.
 */
export async function agentAccessCodeMatches(
  phoneE164: string | null,
  given: string,
): Promise<boolean> {
  const code = typeof given === "string" ? given.trim() : "";
  if (phoneE164 === null || !CODE_SHAPE.test(code)) return false;
  const [row] = await getDb()
    .select({ hash: t.adminAgents.accessCodeHash })
    .from(t.adminAgents)
    .where(
      and(
        eq(t.adminAgents.phoneE164, phoneE164),
        ne(t.adminAgents.status, "disabled"),
        isNotNull(t.adminAgents.accessCodeHash),
      ),
    )
    .limit(1);
  if (!row?.hash) {
    await verifyPassword(code, await timingDecoy());
    return false;
  }
  return verifyPassword(code, row.hash);
}

/** The gate's whole decision: the environment's code, or the operator's own. */
export async function accessCodeAccepted(phoneE164: string | null, given: string): Promise<boolean> {
  if (accessCodeMatches(phoneE164, given)) return true;
  return agentAccessCodeMatches(phoneE164, given);
}

export function isAccessGateConfigured(): boolean {
  return configuredAccounts().size > 0;
}

/** Is this (already normalised) number one the deployment authorised? */
export function isAuthorizedAdminMobile(phoneE164: string | null): boolean {
  return phoneE164 !== null && configuredAccounts().has(phoneE164);
}

/**
 * Constant-time check of the typed code against THAT number's code — one
 * administrator's code never opens another administrator's number. False
 * when the number is not configured.
 */
export function accessCodeMatches(phoneE164: string | null, given: string): boolean {
  if (phoneE164 === null) return false;
  const expected = configuredAccounts().get(phoneE164);
  if (!expected || typeof given !== "string" || !CODE_SHAPE.test(given.trim())) return false;
  return sameSecret(given.trim(), expected);
}

function passSignature(phoneE164: string, exp: number, secret: string): string {
  return createHmac("sha256", secret).update(`gate.${phoneE164}.${exp}`).digest("base64url");
}

export async function issueAccessPass(phoneE164: string): Promise<void> {
  const secret = readOperatorSessionSecret();
  if (!secret) throw new Error("No operator session secret is configured.");
  const exp = Math.floor(Date.now() / 1000) + PASS_SECONDS;
  (await cookies()).set(
    ACCESS_PASS_COOKIE,
    `${exp}.${passSignature(phoneE164, exp, secret)}`,
    {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      path: "/",
      maxAge: PASS_SECONDS,
    },
  );
}

/**
 * True only when this request carries an unexpired pass issued for this
 * number. A pass is minted only after a code was accepted for that number, and
 * its signature binds the number, so nothing else needs re-checking here — a
 * disabled operator is refused by `signInOperatorByPhone` regardless.
 */
export async function hasAccessPass(phoneE164: string): Promise<boolean> {
  const secret = readOperatorSessionSecret();
  if (!secret) return false;
  let value: string | undefined;
  try {
    value = (await cookies()).get(ACCESS_PASS_COOKIE)?.value;
  } catch {
    return false;
  }
  const [expText, signature] = (value ?? "").split(".");
  const exp = Number(expText);
  if (!signature || !Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return false;
  return sameSecret(signature, passSignature(phoneE164, exp, secret));
}

export async function clearAccessPass(): Promise<void> {
  try {
    (await cookies()).delete(ACCESS_PASS_COOKIE);
  } catch {
    // Read-only cookie store; the pass expires on its own in 15 minutes.
  }
}
