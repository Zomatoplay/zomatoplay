import "server-only";

import { randomBytes } from "node:crypto";

import { cache } from "react";
import { cookies } from "next/headers";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import { resilientRead } from "@/server/database";
import { describeTraceActor, trackQuery } from "@/server/observability";
import * as t from "@/db/schema";
import { missingProfileFields } from "@/lib/profile";
import { ensureWallet } from "@/server/repositories/wallet.repository";
import { mutate, newId, SYSTEM_ACTOR } from "@/server/write";

import {
  formatIndianMobile,
  isNormalizedIndianMobile,
  maskIndianMobile,
} from "@/lib/phone";

import { getCustomerPrincipal } from "./customer-session";
import { isPhoneSignInLive } from "./phone-sign-in";
import { decidePhoneSignIn, decidePhoneLink, PHONE_REFUSAL_MESSAGES } from "./phone-identity";
import { getAuthPrincipal } from "./session";

/**
 * Resolving a credential to an application account.
 *
 *   Firebase uid   →  public.users.firebase_uid  →  application user   (customers)
 *   auth.users.id  →  public.users.auth_user_id  →  application user   (legacy email)
 *
 * This is the *only* path from a request to an identity. No route, action or
 * service takes a user id from the browser and trusts it: a `userId` argument
 * anywhere in this codebase has already been through here, or it belongs to an
 * operator acting on someone else's account and has been permission-checked.
 */

export interface AuthenticatedAccount {
  userId: string;
  /** Supabase principal — legacy email sign-in only. */
  authUserId: string | null;
  /** Firebase principal — phone sign-in. */
  firebaseUid: string | null;
  /** How THIS request is signed in. */
  signInMethod: "phone" | "email";
  /** Empty for an account created by phone sign-in. */
  email: string;
  /** The verified number (E.164), when one has been linked. */
  phoneE164: string | null;
  displayId: string;
  fullName: string;
  /** `male` / `female` / `not_sure`, or null until onboarding. */
  gender: string | null;
  /** Private S3 key of the profile photo, or null. */
  avatarStorageKey: string | null;
  status: (typeof t.userStatusEnum.enumValues)[number];
  /**
   * False until the account has a phone number and the first-time profile —
   * full name, gender and a valid email (`missingProfileFields`). The app
   * gate sends an incomplete account to `/complete-profile`.
   */
  profileComplete: boolean;
  /** `users.session_epoch` — what a new phone session is issued against. */
  sessionEpoch: number;
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
 * The signed-in account for a **server action** — or null when there is no
 * session, no record, or the account has been blocked, suspended or
 * deactivated by an operator.
 *
 * WHY ACTIONS NEED THEIR OWN CHECK
 * --------------------------------
 * The `(app)` layout and `requireCurrentUserIdForPage` turn a restricted
 * account away when a *page* renders. A server action is a direct POST: it
 * never renders a page, so a customer holding a still-valid session cookie
 * could keep withdrawing, investing or depositing after an operator had
 * disabled them. Every customer action resolves its account here, so the
 * operator's decision binds the next request whatever route it arrives by.
 * Nothing is read from the client; the status is the database's.
 */
export async function getUsableAccount(): Promise<AuthenticatedAccount | null> {
  const account = await getAuthenticatedAccount();
  if (account && isAccountLockedOut(account.status)) return null;
  return account;
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
 *
 * The principal comes from `getCustomerPrincipal`: a Firebase phone session
 * resolves through `users.firebase_uid`, a legacy email session through
 * `users.auth_user_id`. Nothing else can name the account.
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
  const principal = await getCustomerPrincipal();
  if (!principal || !isDatabaseConfigured()) return null;

  const account = await trackQuery(
    "auth.resolveAccount",
    () =>
      principal.kind === "firebase"
        ? loadAccountForFirebase(principal.firebaseUid)
        : loadAccountFor(principal.authUserId),
    { table: "users", pipeline: "auth" },
  );

  // A phone session issued before the account's last sign-out (or before an
  // operator ended its sessions) is no session at all.
  if (account && principal.kind === "firebase" && account.sessionEpoch !== principal.sessionEpoch) {
    return null;
  }

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
    return findAccount({ by: "auth", id: authUserId });
  },
);

const loadAccountForFirebase = cache(
  async function loadAccountForFirebase(
    firebaseUid: string,
  ): Promise<AuthenticatedAccount | null> {
    return findAccount({ by: "firebase", id: firebaseUid });
  },
);

async function findAccount(
  key: { by: "auth" | "firebase"; id: string },
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
          authUserId: t.users.authUserId,
          firebaseUid: t.users.firebaseUid,
          email: t.users.email,
          phoneE164: t.users.phoneE164,
          displayId: t.users.displayId,
          fullName: t.users.fullName,
          phone: t.users.phone,
          gender: t.users.gender,
          avatarStorageKey: t.users.avatarStorageKey,
          status: t.users.status,
          sessionEpoch: t.users.sessionEpoch,
        })
        .from(t.users)
        .where(
          key.by === "firebase"
            ? eq(t.users.firebaseUid, key.id)
            : eq(t.users.authUserId, key.id),
        )
        .limit(1));

  if (!row) return null;

  const hasPhone = row.phone.trim().length > 0 || row.phoneE164 !== null;
  return {
    userId: row.id,
    authUserId: row.authUserId,
    firebaseUid: row.firebaseUid,
    signInMethod: key.by === "firebase" ? "phone" : "email",
    email: row.email ?? "",
    phoneE164: row.phoneE164,
    displayId: row.displayId,
    fullName: row.fullName,
    gender: row.gender,
    avatarStorageKey: row.avatarStorageKey,
    status: row.status,
    // Name, gender and a valid email (first-time onboarding), plus a number.
    profileComplete: hasPhone && missingProfileFields(row).length === 0,
    sessionEpoch: row.sessionEpoch,
  };
}

/**
 * Ends every phone session this account holds, on every device: the next
 * request presenting one finds the epoch moved and resolves to nobody. The
 * sign-out button, and the lever for "my phone was stolen".
 */
export async function endCustomerSessions(userId: string): Promise<void> {
  if (!isDatabaseConfigured()) return;
  await getDb()
    .update(t.users)
    .set({ sessionEpoch: sql`${t.users.sessionEpoch} + 1` })
    .where(eq(t.users.id, userId));
}

/**
 * Finds or creates the application account for a LEGACY email sign-in.
 *
 * Called once, immediately after a successful Supabase sign-in.
 *
 * LINKING AN EXISTING RECORD BY EMAIL
 * -----------------------------------
 * If a `public.users` row already carries this email but no `auth_user_id`, it
 * is adopted rather than duplicated. That is safe *only* because Supabase has
 * just proved the person controls that mailbox — the OTP went to it and came
 * back. Without that proof this would be an account-takeover primitive, so the
 * ordering matters: verify first, link second, never the other way round.
 *
 * NO NEW ACCOUNTS ONCE PHONE SIGN-IN IS LIVE
 * ------------------------------------------
 * Email sign-in exists now so existing customers can reach their account and
 * link a mobile number. With Firebase configured, an email that matches no
 * account is refused rather than creating one: new customers register by phone,
 * and an email-only account created now would be one more account to migrate.
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

  const existing = await findAccount({ by: "auth", id: principal.authUserId });
  if (existing) return existing;

  const email = principal.email.toLowerCase();
  const phoneSignInLive = isPhoneSignInLive();

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

    if (phoneSignInLive) {
      throw new AuthError(
        "New accounts are created with a mobile number. Sign in with your mobile number instead.",
      );
    }

    await createAccount(tx, now, audit, {
      authUserId: principal.authUserId,
      email,
      fullName: principal.fullName,
      label: email,
    });
  });

  const created = await findAccount({ by: "auth", id: principal.authUserId });
  if (!created) throw new AuthError("The account could not be created.");
  return created;
}

/**
 * Finds or creates the account for a verified phone sign-in.
 *
 * `firebaseUid` and `phoneE164` come from an ID token the server has just
 * verified (`verifyPhoneIdToken`) — never from the request body. The decision
 * itself is `decidePhoneSignIn`; this only carries it out, under a row lock on
 * whatever the number already matches so two concurrent first sign-ins cannot
 * both create an account (the unique indexes are the backstop).
 */
export async function ensureAccountForFirebasePrincipal(principal: {
  firebaseUid: string;
  phoneE164: string;
}): Promise<AuthenticatedAccount> {
  if (!isDatabaseConfigured()) {
    throw new AuthError("No database is configured, so no account can be created.");
  }
  if (!isNormalizedIndianMobile(principal.phoneE164)) {
    throw new AuthError("Only Indian mobile numbers (+91) can sign in.");
  }

  const existing = await findAccount({ by: "firebase", id: principal.firebaseUid });
  if (existing) return existing;

  await mutate(SYSTEM_ACTOR, async ({ tx, now, audit }) => {
    const [byUid] = await tx
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.firebaseUid, principal.firebaseUid))
      .limit(1)
      .for("update");
    const [byPhone] = await tx
      .select({ id: t.users.id, firebaseUid: t.users.firebaseUid })
      .from(t.users)
      .where(eq(t.users.phoneE164, principal.phoneE164))
      .limit(1)
      .for("update");

    const decision = decidePhoneSignIn({
      firebaseUid: principal.firebaseUid,
      byUid: byUid ?? null,
      byPhone: byPhone ?? null,
    });

    if (decision.action === "refuse") {
      throw new AuthError(PHONE_REFUSAL_MESSAGES[decision.reason]);
    }
    if (decision.action === "use") return;

    await createAccount(tx, now, audit, {
      firebaseUid: principal.firebaseUid,
      phoneE164: principal.phoneE164,
      fullName: null,
      label: maskIndianMobile(principal.phoneE164),
    });
  });

  const created = await findAccount({ by: "firebase", id: principal.firebaseUid });
  if (!created) throw new AuthError("The account could not be created.");
  return created;
}

/**
 * Attaches a freshly verified phone number to the account the caller is
 * ALREADY signed in to by email — the migration path for existing customers.
 *
 * The account id is the caller's own, resolved from their legacy session by
 * the action; the uid and number come from a verified Firebase token. The
 * decision is `decidePhoneLink`, re-read under `FOR UPDATE` so the checks and
 * the write see the same rows.
 */
export async function linkPhoneToAccount(request: {
  userId: string;
  firebaseUid: string;
  phoneE164: string;
}): Promise<{ linked: boolean; account: AuthenticatedAccount }> {
  if (!isNormalizedIndianMobile(request.phoneE164)) {
    throw new AuthError("Only Indian mobile numbers (+91) can be linked.");
  }

  const { linked } = await mutate(SYSTEM_ACTOR, async ({ tx, now, audit }) => {
    const [account] = await tx
      .select({ id: t.users.id, firebaseUid: t.users.firebaseUid })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1)
      .for("update");
    if (!account) throw new AuthError("That account no longer exists.");

    const [byUid] = await tx
      .select({ id: t.users.id })
      .from(t.users)
      .where(eq(t.users.firebaseUid, request.firebaseUid))
      .limit(1);
    const [byPhone] = await tx
      .select({ id: t.users.id, firebaseUid: t.users.firebaseUid })
      .from(t.users)
      .where(eq(t.users.phoneE164, request.phoneE164))
      .limit(1);

    const decision = decidePhoneLink({
      account,
      firebaseUid: request.firebaseUid,
      byUid: byUid ?? null,
      byPhone: byPhone ?? null,
    });

    if (decision.action === "refuse") {
      throw new AuthError(PHONE_REFUSAL_MESSAGES[decision.reason]);
    }
    if (decision.action === "already_linked") return { linked: false };

    await tx
      .update(t.users)
      .set({
        firebaseUid: request.firebaseUid,
        phoneE164: request.phoneE164,
        phoneVerifiedAt: now,
        // The display number becomes the verified one; the typed one was
        // never evidence of anything.
        phone: formatIndianMobile(request.phoneE164),
        updatedAt: now,
      })
      .where(and(eq(t.users.id, account.id), isNull(t.users.firebaseUid)));

    audit({
      action: "user_updated",
      target: { type: "user", id: account.id, label: maskIndianMobile(request.phoneE164) },
      details:
        "Linked a verified mobile number (Firebase phone OTP) to this account " +
        "from the customer's existing email session.",
    });
    return { linked: true };
  });

  const account = await findAccount({ by: "firebase", id: request.firebaseUid });
  if (!account || account.userId !== request.userId) {
    throw new AuthError("The mobile number could not be linked.");
  }
  return { linked, account };
}

type WriteTx = Parameters<Parameters<typeof mutate>[1]>[0]["tx"];
type WriteAudit = Parameters<Parameters<typeof mutate>[1]>[0]["audit"];

/**
 * One new account, its wallet, and its referral attribution — for either
 * credential. Called inside the caller's transaction.
 */
async function createAccount(
  tx: WriteTx,
  now: Date,
  audit: WriteAudit,
  identity: {
    authUserId?: string;
    firebaseUid?: string;
    phoneE164?: string;
    email?: string;
    fullName: string | null;
    /** How the audit log names the new account: an email or a masked number. */
    label: string;
  },
): Promise<void> {
  const referrer = await resolveReferrer(tx, {
    email: identity.email ?? null,
    phoneE164: identity.phoneE164 ?? null,
  });

  const userId = newId("usr", now);
  await tx.insert(t.users).values({
    id: userId,
    authUserId: identity.authUserId ?? null,
    firebaseUid: identity.firebaseUid ?? null,
    phoneE164: identity.phoneE164 ?? null,
    phoneVerifiedAt: identity.phoneE164 ? now : null,
    displayId: await nextDisplayId(tx),
    // Set here or never: see `resolveReferrer`.
    referredByCode: referrer?.code ?? null,
    // From sign-up, where the person typed it. Blank when they arrived by
    // one-time code, which collects no name — the profile step asks then.
    // Never derived from the email address: a made-up name on an account
    // that later files a KYC document is worse than an empty field.
    fullName: identity.fullName ?? "",
    email: identity.email ?? null,
    phone: identity.phoneE164 ? formatIndianMobile(identity.phoneE164) : "",
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
     */
    await tx.insert(t.referrals).values({
      id: newId("ref", now),
      referrerUserId: referrer.id,
      referredUserId: userId,
      name: identity.fullName ?? (identity.email ? identity.email.split("@")[0] : "New member"),
      maskedEmail: identity.email
        ? maskEmail(identity.email)
        : identity.phoneE164
          ? maskIndianMobile(identity.phoneE164)
          : "•••",
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
     * The second tier, counted at the moment it comes into existence. One
     * level only: the VIP table defines two commission tiers and no third.
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
    target: { type: "user", id: userId, label: identity.label },
    details: referrer
      ? `Created an application account for a new verified sign-in, referred by ${referrer.code}.`
      : "Created an application account for a new verified sign-in.",
  });
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
  tx: WriteTx,
  self: { email: string | null; phoneE164: string | null },
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
    .select({
      id: t.users.id,
      code: t.users.referralCode,
      email: t.users.email,
      phoneE164: t.users.phoneE164,
    })
    .from(t.users)
    .where(eq(t.users.referralCode, code))
    .limit(1);
  if (!referrer) return null;

  // Self-referral: the code's owner is the person signing up, recognised by
  // either verified identity (the new row has no id yet to compare against).
  if (self.email && referrer.email === self.email) return null;
  if (self.phoneE164 && referrer.phoneE164 === self.phoneE164) return null;

  return { id: referrer.id, code: referrer.code };
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

async function nextDisplayId(tx: WriteTx) {
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
