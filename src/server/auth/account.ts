import "server-only";

import { randomBytes } from "node:crypto";

import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, inArray, ne, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import { resilientRead } from "@/server/database";
import { describeTraceActor, trackQuery } from "@/server/observability";
import * as t from "@/db/schema";
import { ensureWallet } from "@/server/repositories/wallet.repository";
import { mutate, newId, SYSTEM_ACTOR } from "@/server/write";

import { getAuthPrincipal, type AuthPrincipal } from "./session";

/**
 * Resolving a credential to an application account.
 *
 *   auth.users.id  →  public.users.auth_user_id  →  application user
 *
 * This is the *only* path from a request to an identity. No route, action or
 * service takes a user id from the browser and trusts it: a `userId` argument
 * anywhere in this codebase has already been through here, or it belongs to an
 * operator acting on someone else's account and has been permission-checked.
 */

export interface AuthenticatedAccount {
  userId: string;
  authUserId: string;
  email: string;
  displayId: string;
  fullName: string;
  status: (typeof t.userStatusEnum.enumValues)[number];
  /** False until the account has a name and a phone number on file. */
  profileComplete: boolean;
}

/**
 * Statuses that keep a signed-in account out of the application.
 *
 * An operator blocking someone in the CRM has to mean something on the user's
 * next request, or the CRM is describing a decision the product ignores.
 */
export function isAccountLockedOut(
  status: (typeof t.userStatusEnum.enumValues)[number],
): boolean {
  return status === "blocked" || status === "suspended" || status === "deactivated";
}

/**
 * The signed-in account, or null when there is no session or no record yet.
 *
 * Memoised per request for the same reason `getAuthPrincipal` is: it adds a
 * `users` lookup (~206ms) on top of the session verification, and a page that
 * called three services used to pay for both, three times.
 *
 * Request-scoped only. A later request re-verifies and re-reads, so an account
 * blocked between two requests is blocked on the second one.
 */
export async function getAuthenticatedAccount(): Promise<AuthenticatedAccount | null> {
  /*
   * Both steps are memoised, and both are timed in *this* context.
   *
   * The two calls are kept side by side rather than nested for a reason
   * specific to React's `cache()`: it runs its function in its own async
   * context, so a `trackPipeline` inside a cached function loses the request's
   * trace and lands under a fresh correlation id. Resolving the principal here,
   * before the cached account lookup, keeps both steps in one trace.
   */
  const principal = await getAuthPrincipal();
  if (!principal || !isDatabaseConfigured()) return null;

  const account = await trackQuery(
    "auth.resolveAccount",
    () => loadAccountFor(principal.authUserId),
    { table: "users", pipeline: "auth" },
  );

  if (account) {
    // Lets every event in this trace carry the account, including the ones
    // recorded before the identity was known.
    describeTraceActor({ userId: account.userId, actorType: "user" });
  }
  return account;
}

/** Keyed on the principal, so both call styles share one entry. */
const loadAccountFor = cache(
  async function loadAccountFor(
    authUserId: string,
  ): Promise<AuthenticatedAccount | null> {
    return findAccountForPrincipal({
      authUserId,
      email: null,
      emailConfirmedAt: null,
      fullName: null,
    });
  },
);

async function findAccountForPrincipal(
  principal: AuthPrincipal,
): Promise<AuthenticatedAccount | null> {
  /*
   * The single hottest query in the application: every authenticated request
   * resolves its account through here.
   *
   * It is wrapped in `resilientRead` because it was also the one failing most
   * visibly. Telemetry over one measurement session: 73 failures, split between
   * `CONNECT_TIMEOUT` and a wrapped driver error, at an average of **55–71
   * seconds** each — one unhealthy pooler endpoint, no deadline, no retry, on
   * the query that gates every page.
   *
   * A read, and idempotent, so retrying it is safe.
   */
  const [row] = await resilientRead(async () =>
      getDb()
        // Only the columns this projection uses. `select()` pulled all
        // thirty-odd, including internal notes and restriction flags, on the
        // hottest read in the application.
        .select({
          id: t.users.id,
          email: t.users.email,
          displayId: t.users.displayId,
          fullName: t.users.fullName,
          phone: t.users.phone,
          status: t.users.status,
        })
        .from(t.users)
        .where(eq(t.users.authUserId, principal.authUserId))
        .limit(1));

  if (!row) return null;

  return {
    userId: row.id,
    authUserId: principal.authUserId,
    email: row.email,
    displayId: row.displayId,
    fullName: row.fullName,
    status: row.status,
    profileComplete: row.fullName.trim().length > 0 && row.phone.trim().length > 0,
  };
}

/**
 * Finds or creates the application account for the signed-in principal.
 *
 * Called once, immediately after a successful OTP verification.
 *
 * LINKING AN EXISTING RECORD BY EMAIL
 * -----------------------------------
 * If a `public.users` row already carries this email but no `auth_user_id`, it
 * is adopted rather than duplicated. That is safe *only* because Supabase has
 * just proved the person controls that mailbox — the OTP went to it and came
 * back. Without that proof this would be an account-takeover primitive, so the
 * ordering matters: verify first, link second, never the other way round.
 */
export async function ensureAccountForCurrentPrincipal(): Promise<AuthenticatedAccount> {
  const principal = await getAuthPrincipal();
  if (!principal) {
    throw new AuthError("Not signed in.");
  }
  if (!principal.email) {
    throw new AuthError("This sign-in method provided no email address.");
  }
  if (!isDatabaseConfigured()) {
    throw new AuthError("No database is configured, so no account can be created.");
  }

  const existing = await findAccountForPrincipal(principal);
  if (existing) return existing;

  const email = principal.email.toLowerCase();

  await mutate(SYSTEM_ACTOR, async ({ tx, now, audit }) => {
    const [byEmail] = await tx
      .select({ id: t.users.id, authUserId: t.users.authUserId })
      .from(t.users)
      .where(eq(t.users.email, email))
      .limit(1)
      .for("update");

    if (byEmail) {
      if (byEmail.authUserId && byEmail.authUserId !== principal.authUserId) {
        throw new AuthError(
          "That email is already linked to a different sign-in. Contact support.",
        );
      }
      await tx
        .update(t.users)
        .set({ authUserId: principal.authUserId, lastActiveAt: now, updatedAt: now })
        .where(eq(t.users.id, byEmail.id));
      await ensureWallet(tx, byEmail.id);

      audit({
        action: "user_updated",
        target: { type: "user", id: byEmail.id, label: email },
        details: "Linked an existing account to a verified Supabase sign-in.",
      });
      return;
    }

    const referrer = await resolveReferrer(tx, email);

    const userId = newId("usr", now);
    await tx.insert(t.users).values({
      id: userId,
      authUserId: principal.authUserId,
      displayId: await nextDisplayId(tx),
      // Set here or never: see `resolveReferrer`.
      referredByCode: referrer?.code ?? null,
      // From sign-up, where the person typed it. Blank when they arrived by
      // one-time code, which collects no name — the profile step asks then.
      // Never derived from the email address: a made-up name on an account
      // that later files a KYC document is worse than an empty field.
      fullName: principal.fullName ?? "",
      email,
      phone: "",
      registeredAt: now,
      lastActiveAt: now,
      kycStatus: "not_started",
      referralCode: referralCodeFor(userId),
      walletAddress: "",
      createdAt: now,
      updatedAt: now,
    });
    await ensureWallet(tx, userId);

    if (referrer) {
      /*
       * The relationship, and the referrer's counters, in the same transaction
       * as the account. A referral row whose user does not exist — or an
       * account whose referral row failed to write — is the kind of split that
       * makes a commission ledger impossible to reconcile later.
       *
       * No money moves. Commission calculation is not implemented; see
       * FUTURE_TASKS.md. What is recorded here is who introduced whom.
       */
      await tx.insert(t.referrals).values({
        id: newId("ref", now),
        referrerUserId: referrer.id,
        referredUserId: userId,
        name: principal.fullName ?? email.split("@")[0],
        maskedEmail: maskEmail(email),
        joinedAt: now,
        status: "registered",
        tier: 1,
      });

      await tx
        .update(t.users)
        .set({ referralCount: sql`${t.users.referralCount} + 1`, updatedAt: now })
        .where(eq(t.users.id, referrer.id));

      await tx
        .insert(t.referralAccounts)
        .values({ userId: referrer.id, directReferrals: 1, joinedAt: now })
        .onConflictDoUpdate({
          target: t.referralAccounts.userId,
          set: { directReferrals: sql`${t.referralAccounts.directReferrals} + 1` },
        });

      /*
       * The second tier, counted at the moment it comes into existence.
       *
       * `total_referrals` on the referral screen is direct + indirect, and
       * `indirect_referrals` had no writer at all — so a VIP 2 referrer whose
       * own referral brought somebody in saw a total that silently understated
       * their team. Counted here rather than when that person invests, because
       * the relationship exists from signup; what invests later is the volume,
       * not the headcount.
       *
       * One level only. The VIP table defines two commission tiers and there is
       * no third, so there is no chain to walk and no cycle to guard against.
       */
      const [grandparent] = await tx
        .select({ referrerUserId: t.referrals.referrerUserId })
        .from(t.referrals)
        .where(eq(t.referrals.referredUserId, referrer.id))
        .limit(1);

      if (grandparent) {
        await tx
          .insert(t.referralAccounts)
          .values({
            userId: grandparent.referrerUserId,
            indirectReferrals: 1,
            joinedAt: now,
          })
          .onConflictDoUpdate({
            target: t.referralAccounts.userId,
            set: {
              indirectReferrals: sql`${t.referralAccounts.indirectReferrals} + 1`,
            },
          });
      }
    }

    audit({
      action: "user_updated",
      target: { type: "user", id: userId, label: email },
      details: referrer
        ? `Created an application account for a new verified sign-in, referred by ${referrer.code}.`
        : "Created an application account for a new verified sign-in.",
    });
  });

  const created = await findAccountForPrincipal(principal);
  if (!created) throw new AuthError("The account could not be created.");
  return created;
}

const REFERRAL_COOKIE = "nanotron-ref";

/**
 * Resolves the captured referral code to a real referrer, once.
 *
 * ATTRIBUTION IS SET AT CREATION AND NEVER AGAIN
 * ----------------------------------------------
 * This is called only on the insert path. An account that already exists is
 * never re-attributed — not when it is adopted by email, not on a later
 * sign-in. A referrer who could be changed afterwards is a referrer who can be
 * stolen, and commission built on top of a mutable relationship is
 * unreconcilable.
 *
 * WHAT IS REFUSED
 * ---------------
 * - a code that names nobody (a typo, or an invented one);
 * - a code belonging to the account being created, which is the self-referral
 *   case — checked by email, because at this moment the new row does not exist
 *   and has no id to compare against;
 * - a malformed code, already filtered by the middleware that stored it.
 *
 * Returns null for all of them. A bad code costs the signup nothing: the
 * account is created unattributed rather than refused, because a broken link is
 * not the new user's fault.
 */
async function resolveReferrer(
  tx: Parameters<Parameters<typeof mutate>[1]>[0]["tx"],
  email: string,
): Promise<{ id: string; code: string } | null> {
  let code: string | undefined;
  try {
    code = (await cookies()).get(REFERRAL_COOKIE)?.value?.trim().toUpperCase();
  } catch {
    // No request scope — a script creating an account has no referral context.
    return null;
  }
  if (!code || !/^[A-Za-z0-9]{4,32}$/.test(code)) return null;

  const [referrer] = await tx
    .select({ id: t.users.id, code: t.users.referralCode, email: t.users.email })
    .from(t.users)
    .where(
      and(
        eq(t.users.referralCode, code),
        // Self-referral: the code's owner is the person signing up.
        ne(t.users.email, email),
      ),
    )
    .limit(1);

  return referrer ? { id: referrer.id, code: referrer.code } : null;
}

/**
 * The member id a person sees: `NT-` and seven digits.
 *
 * WHAT WAS WRONG WITH THE OLD VERSION
 * -----------------------------------
 * It ran a query on every signup, discarded the result with `void row`, and
 * then returned `NT-${Date.now().toString().slice(-7)}` — the last seven
 * digits of a millisecond clock. Three separate problems in six lines:
 *
 *  - the query was a wasted round trip (~200 ms) inside the account-creation
 *    transaction, so it also held that transaction open for longer;
 *  - the doc comment claimed it continued the seeded sequence, and it did
 *    nothing of the kind;
 *  - `display_id` carries a **unique index**, and the last seven digits of a
 *    millisecond clock repeat every 10,000,000 ms — every **2 h 46 m**. Two
 *    signups in the same millisecond, or exactly that interval apart, collided
 *    and the unique violation failed the entire registration with an opaque
 *    constraint error. That is a deterministic failure window, not bad luck.
 *
 * WHAT THIS DOES INSTEAD, IN THE SAME ONE ROUND TRIP
 * -------------------------------------------------
 * Generates several cryptographically random candidates, asks in a single
 * query which of them are already taken, and returns one that is not. The
 * query the old code wasted is now the query that does the work, so this costs
 * nothing extra and removes the collision window.
 *
 * Random rather than a sequence, deliberately: a sequential member id would
 * publish signup order and total user count to anybody who registers twice.
 *
 * The unique index remains the real guarantee — two concurrent signups can
 * still pick the same free candidate between this read and their inserts. That
 * is now a genuinely improbable event rather than a scheduled one, and the
 * fallback below makes even that recoverable.
 */
const DISPLAY_ID_CANDIDATES = 5;

async function nextDisplayId(tx: Parameters<Parameters<typeof mutate>[1]>[0]["tx"]) {
  const candidates = Array.from({ length: DISPLAY_ID_CANDIDATES }, () =>
    generateMemberId(),
  );

  const taken = await tx
    .select({ displayId: t.users.displayId })
    .from(t.users)
    .where(inArray(t.users.displayId, candidates));

  const used = new Set(taken.map((row) => row.displayId));
  const free = candidates.find((candidate) => !used.has(candidate));
  if (free) return free;

  /*
   * Every candidate was taken, which at a seven-digit space means the space is
   * genuinely crowded. Widening beats failing the registration: a member id is
   * a label, and refusing somebody an account because of one would be the
   * worst possible trade.
   */
  return displayIdFrom(randomDigits(10));
}

/**
 * One candidate member id: `NT-` and seven random digits.
 *
 * Exported so the shape can be asserted against the generator rather than
 * against the `users` table. The table is not a safe place to assert it: the
 * integration suites share one live database and several of them insert
 * accounts directly with ids of their own shape (`NT-M…`, `NT-R…`, `NT-D…`),
 * so a test reading every row is reading other files' scratch data. That is
 * the same hazard CLAUDE.md §16.7 describes — assert the property the test
 * owns, never a fact about the physical table. The invariant the table *does*
 * owe is uniqueness, and the unique index is what enforces it.
 */
export function generateMemberId(): string {
  return displayIdFrom(randomDigits(7));
}

function displayIdFrom(digits: string): string {
  return `NT-${digits}`;
}

/** Uniformly random digits, from the CSPRNG rather than `Math.random()`. */
function randomDigits(count: number): string {
  const bytes = randomBytes(count);
  let out = "";
  for (let i = 0; i < count; i++) {
    // Modulo 10 over a byte is very slightly biased toward 0–5. That is
    // irrelevant for a collision-avoidance label and would matter only if this
    // were a secret, which it is not.
    out += (bytes[i] % 10).toString();
  }
  return out;
}

/** `a***v@example.com` — enough for a referrer to recognise, not to contact. */
function maskEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "•••";
  const head = local.slice(0, 1);
  const tail = local.length > 1 ? local.slice(-1) : "";
  return `${head}${"•".repeat(Math.max(local.length - 2, 1))}${tail}@${domain}`;
}

function referralCodeFor(userId: string) {
  return userId.replace(/[^a-z0-9]/gi, "").slice(-8).toUpperCase();
}

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}
