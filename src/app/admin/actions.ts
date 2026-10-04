"use server";

import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";

import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireSupabaseConfig } from "@/lib/supabase/env";
import { getSiteUrl } from "@/lib/site-url";
import {
  replyToTicketAsSupport,
  setTicketStatus,
} from "@/server/services/tickets-write.service";
import { financeSettingsRefusal } from "@/lib/platform-finance";
import { parseSupportEmail, parseTelegramUsername, telegramLabel } from "@/lib/support";
import { maskIndianMobile, normalizeIndianMobile } from "@/lib/phone";
import { sendPasswordRecovery } from "@/lib/supabase/auth-rest";
import {
  describeError,
  errorDiagnostics,
  recordPipelineEvent,
  trackPipeline,
} from "@/server/observability";
import { toSafeFailure } from "@/server/errors";
import type { AdminUserOption } from "@/types/admin";
import { traceAction } from "@/server/trace-action";
import { requirePermission } from "@/server/admin/session";
import { isLegacyEmailSignInEnabled } from "@/server/auth/phone-sign-in";
import { hashPassword } from "@/server/auth/password-hash";
import { findUsersForPicker } from "@/server/services/admin.service";
import { revalidate, revalidateCatalogue } from "@/server/revalidate";
import {
  revokeDeviceSessions,
  setUserRestriction,
  setUserStatus,
  updateUserProfile,
} from "@/server/services/account-write.service";
import {
  addKycNote,
  approveKyc,
  rejectKyc,
  requestKycResubmission,
} from "@/server/services/kyc-write.service";
import {
  assignDepositToUser,
  creditAttributedDeposit,
  failDeposit,
  ignoreDeposit,
  reopenDeposit,
} from "@/server/services/deposits.service";
import { setDepositAddress } from "@/server/services/deposit-settings.service";
import {
  previewPlanRate,
  savePlanRateTiers,
  type TierDraft,
  type TierPreview,
} from "@/server/services/plan-tiers-write.service";
import { savePlanDurationRates } from "@/server/services/plan-duration-rates-write.service";
import type { DurationRateDraft } from "@/lib/plan-durations";
import {
  approveWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
} from "@/server/services/withdrawals-write.service";
import { releaseCommission } from "@/server/services/referrals-write.service";
import { resetWithdrawalPassword } from "@/server/services/withdrawal-password.service";
import {
  creditWalletManually,
  findCustomerForCredit,
  type ManualCreditCustomer,
} from "@/server/services/manual-credit.service";
import { KycStorageError } from "@/server/storage/kyc-storage";
import { signStoredKycDocument } from "@/server/storage/kyc-document-store";
import { mutate, newId, withReason } from "@/server/write";
import type {
  AdminPermissionSet,
  AdminUserRestrictions,
  AdminUserStatus,
  PlatformSettings,
  StoredPlatformSection,
} from "@/types/admin";

/**
 * Every operator decision, as a server action.
 *
 * THE SHAPE THEY ALL SHARE
 * ------------------------
 *   requirePermission(area)   → resolves the operator from the *session* and
 *                               asserts the grant stored in the database
 *   mutate(operator.actor, …) → one transaction, audit entry written inside it
 *   revalidate(…)             → the CRM and, where relevant, the user app
 *
 * None of them takes an operator id. That is the whole point of this file
 * existing in its current form: the CRM used to send `{ operator: { agentId,
 * name, role } }` with each call, because the "session" was a dropdown in the
 * header. A caller could name themselves the master admin and approve anything.
 * Identity now comes from a verified Supabase principal via
 * `admin_agents.auth_user_id`, and there is no parameter to forge.
 *
 * WHY THEY LIVE HERE AND NOT UNDER THE ROUTE
 * ------------------------------------------
 * `(console)` is a route group, so the pages' filesystem paths carry a segment
 * their URLs do not. Actions imported by client components would then have
 * import paths like `@/app/admin/(console)/kyc/actions`, which break the moment
 * the grouping changes. This module is not a route; its path is stable.
 */

/**
 * The origin a Supabase email link should point back at.
 *
 * `NEXT_PUBLIC_SITE_URL` first — an explicit deployment decision outranks
 * anything inferred. Failing that, the request's own host, so a link generated
 * on a preview deployment returns to that deployment. The Host header is
 * attacker-supplied in principle, but Supabase honours only origins on the
 * project's redirect allow-list, so a forged one cannot redirect anybody
 * anywhere the project has not approved.
 *
 * It no longer falls back to `localhost`: that fallback was the one path in
 * this file that could put a development URL into a production email.
 */
async function originForEmails(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");

  try {
    const store = await headers();
    const host = store.get("x-forwarded-host") ?? store.get("host");
    const proto = store.get("x-forwarded-proto") ?? "https";
    if (host) return `${proto}://${host}`;
  } catch {
    // No request scope.
  }
  return getSiteUrl();
}

export interface AdminActionResult {
  ok: boolean;
  message: string;
  /** True when the same action, tried again, could plausibly succeed. */
  retryable?: boolean;
}

/**
 * Turns a thrown value into something an operator may be shown.
 *
 * WHAT WAS WRONG WITH THE OLD VERSION
 * -----------------------------------
 * Its comment said "anything else gets the generic text rather than a database
 * error string", and its code did the opposite: the final branch returned
 * `error.message` for every `Error`, so a Drizzle failure put raw SQL and its
 * bound parameters into a toast. The `fallback` argument every call site passes
 * was only ever used for a non-`Error` throw, which essentially never happens.
 *
 * `toSafeFailure` implements what that comment intended: an allowlist of this
 * application's own error classes may speak, everything else is described from
 * its category. The real message is still recorded — with its whole cause
 * chain — by the action's own instrumentation, so nothing is lost to the
 * operator who needs it, only to the toast that should not carry it.
 */
function failed(error: unknown, fallback: string): AdminActionResult {
  const failure = toSafeFailure(error, fallback);

  recordPipelineEvent({
    pipeline: "admin",
    operation: "admin.action.failed",
    status: "failed",
    message: fallback,
    errorMessage: describeError(error),
    metadata: {
      errorCategory: failure.category,
      retryable: failure.retryable,
      ...errorDiagnostics(error),
    },
  });

  return { ok: false, message: failure.message, retryable: failure.retryable };
}

function requireReason(reason: string | undefined, what: string) {
  const trimmed = reason?.trim();
  if (!trimmed) {
    throw Object.assign(new Error(`A reason is required to ${what}.`), {
      name: "AdminValidationError",
    });
  }
  return trimmed;
}

/* -------------------------------------------------------------------------- */
/* KYC                                                                         */
/* -------------------------------------------------------------------------- */

function refreshKyc() {
  // `/settings/kyc` and `/` are the user's side of the same decision. An
  // approval the CRM records and the user cannot see is half a feature.
  revalidate("/admin/kyc", "/admin/users", "/admin", "/settings/kyc", "/settings", "/");
}

export async function approveKycAction(input: {
  submissionId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("kyc");
    await trackPipeline(
      {
        pipeline: "kyc",
        operation: "kyc.approve",
        message: "Operator approved a verification",
        actor: operator.actor,
        subject: { type: "kyc", id: input.submissionId },
      },
      () => approveKyc(input, operator.actor),
    );
    refreshKyc();
    return { ok: true, message: "Verification approved." };
  } catch (error) {
    return failed(error, "The decision was not recorded.");
  }
}

export async function rejectKycAction(input: {
  submissionId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("kyc");
    await trackPipeline(
      {
        pipeline: "kyc",
        operation: "kyc.reject",
        message: "Operator rejected a verification",
        actor: operator.actor,
        subject: { type: "kyc", id: input.submissionId },
      },
      () => rejectKyc(input, operator.actor),
    );
    refreshKyc();
    return { ok: true, message: "Verification rejected." };
  } catch (error) {
    return failed(error, "The decision was not recorded.");
  }
}

export async function requestKycResubmissionAction(input: {
  submissionId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("kyc");
    await requestKycResubmission(input, operator.actor);
    refreshKyc();
    return { ok: true, message: "Resubmission requested." };
  } catch (error) {
    return failed(error, "The request was not recorded.");
  }
}

/**
 * A short-lived link to one identity document, for a reviewer.
 *
 * TWO INDEPENDENT GATES, AND BOTH ARE REAL
 * ----------------------------------------
 * `requirePermission("kyc")` resolves the operator from their Supabase session
 * and asserts the grant stored in the database — the same gate every other
 * decision here passes. Then the storage policy asks the same question again in
 * Postgres, through `public.is_kyc_operator()`, because the signed URL is
 * minted with the operator's *own* session rather than a service-role key. An
 * operator who lost their grant between the two checks is refused by the
 * second.
 *
 * The document id is looked up rather than trusted: the caller sends a row id,
 * and the object key comes from that row. A caller cannot name an arbitrary
 * storage path.
 *
 * The URL expires in two minutes. Long enough to open a scan, short enough that
 * a link pasted into a chat is dead by the time anyone reads it.
 */
export async function signKycDocumentAction(input: {
  documentId: string;
}): Promise<AdminActionResult & { url?: string }> {
  try {
    await requirePermission("kyc", "view");

    const [document] = await getDb()
      .select({
        path: t.kycDocuments.storagePath,
        backend: t.kycDocuments.storageBackend,
      })
      .from(t.kycDocuments)
      .where(eq(t.kycDocuments.id, input.documentId))
      .limit(1);

    if (!document) {
      return { ok: false, message: "That document no longer exists." };
    }
    if (!document.path) {
      // A row from before storage existed. Saying so is better than a link that
      // 404s and leaves a reviewer wondering whether the file was deleted.
      return {
        ok: false,
        message: "This submission predates document storage — there is no file to open.",
      };
    }

    // S3 or the legacy bucket, by what the row says — the key alone cannot.
    const url = await signStoredKycDocument(document.path, document.backend, 120);
    return { ok: true, message: "Opening the document.", url };
  } catch (error) {
    return failed(
      error,
      error instanceof KycStorageError
        ? error.message
        : "The document could not be opened.",
    );
  }
}

export async function addKycNoteAction(input: {
  submissionId: string;
  body: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("kyc");
    await addKycNote(input, operator.actor);
    revalidate("/admin/kyc");
    return { ok: true, message: "Note added." };
  } catch (error) {
    return failed(error, "The note was not saved.");
  }
}

/* -------------------------------------------------------------------------- */
/* Deposits                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Accounts matching an operator's type-ahead, for the pickers that need one —
 * the deposit attribution dialog and the notification composer's single-user
 * audience. Both used to receive the **entire** user directory as a prop and
 * search it in the browser.
 *
 * Gated on `users`, not on the calling screen's own permission, because what
 * this reads *is* the user directory — an operator who may not browse accounts
 * should not be able to enumerate them eight at a time through a side door.
 * The consequential half of each flow keeps its own gate:
 * `assignDepositAction` still requires `deposits: manage` and
 * `sendNotificationAction` still requires `notifications: manage`.
 *
 * `view` rather than `manage`: it reads, it changes nothing. It is still
 * bounded — at most eight narrow rows (no balance, no KYC state), and nothing
 * at all under two characters — so it is a search rather than an export.
 */
export async function searchUsersAction(
  search: string,
): Promise<AdminUserOption[]> {
  await requirePermission("users", "view");
  const needle = search.trim().slice(0, 100);
  if (needle.length < 2) return [];
  return findUsersForPicker(needle);
}

export async function assignDepositAction(input: {
  depositId: string;
  userId: string;
  note?: string;
}): Promise<AdminActionResult> {
  return traceAction(
    { name: "admin.deposit.assign", actorType: "admin", pipeline: "deposit" },
    async () => {
    try {
      const operator = await requirePermission("deposits");
      const { amount } = await trackPipeline(
        {
          pipeline: "deposit",
          operation: "deposit.assign",
          message: "Operator attributed a detected transfer to an account",
          userId: input.userId,
          actor: operator.actor,
          subject: { type: "deposit", id: input.depositId },
        },
        () =>
          assignDepositToUser(
            { depositId: input.depositId, userId: input.userId, note: input.note },
            operator.actor,
          ),
      );
      revalidate("/admin/deposits", "/admin", "/wallet", "/");
      return { ok: true, message: `Credited ${amount} USDT.` };
    } catch (error) {
      return failed(error, "The deposit was not changed.");
    }
    },
  );
}

export async function ignoreDepositAction(input: {
  depositId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("deposits");
    const reason = requireReason(input.reason, "ignore a deposit");
    await ignoreDeposit({ depositId: input.depositId, reason }, operator.actor);
    revalidate("/admin/deposits", "/admin");
    return { ok: true, message: "Deposit ignored." };
  } catch (error) {
    return failed(error, "The deposit was not changed.");
  }
}

export async function creditDepositAction(input: {
  depositId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("deposits");
    const { amount } = await creditAttributedDeposit(
      { depositId: input.depositId, note: input.note },
      operator.actor,
    );
    revalidate("/admin/deposits", "/admin", "/wallet", "/");
    return { ok: true, message: `Credited ${amount} USDT.` };
  } catch (error) {
    return failed(error, "The deposit was not credited.");
  }
}

export async function failDepositAction(input: {
  depositId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("deposits");
    const reason = requireReason(input.reason, "fail a deposit");
    await failDeposit({ depositId: input.depositId, reason }, operator.actor);
    revalidate("/admin/deposits", "/admin", "/wallet", "/");
    return { ok: true, message: "Deposit marked failed." };
  } catch (error) {
    return failed(error, "The deposit was not changed.");
  }
}

export async function reopenDepositAction(input: {
  depositId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("deposits");
    await reopenDeposit(
      { depositId: input.depositId, note: input.note },
      operator.actor,
    );
    revalidate("/admin/deposits", "/admin");
    return { ok: true, message: "Deposit returned to the queue." };
  } catch (error) {
    return failed(error, "The deposit was not changed.");
  }
}

/**
 * Sets the ONE deposit address customers are shown.
 *
 * `manage` over `deposits`, asserted from the session. The address is
 * validated server-side (base58 checksum; never the token contract) and the
 * change is audited with the old and new value in the same transaction — see
 * `setDepositAddress`. It never generates an address: nothing here holds a
 * private key, seed or xpub (CLAUDE.md §18.8). The operator produces the
 * address with their own wallet tooling and pastes it.
 *
 * A reason is required: redirecting where every customer sends money is the
 * most consequential single edit this console can make.
 */
export async function setDepositAddressAction(input: {
  address: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("deposits");
    const reason = requireReason(input.reason, "change the deposit address");
    const result = await trackPipeline(
      {
        pipeline: "deposit",
        operation: "deposit.address.configure",
        message: "Operator changed the deposit address",
        actor: operator.actor,
        subject: { type: "settings", id: "deposit-address" },
      },
      () => setDepositAddress({ address: String(input.address ?? ""), note: reason }, operator.actor),
    );
    revalidate("/admin/deposits/configuration", "/admin/deposits", "/admin/audit-logs", "/wallet/deposit");
    return {
      ok: true,
      message: result.changed
        ? "Deposit address saved. New deposit requests use it from now on."
        : "That is already the deposit address; nothing was changed.",
    };
  } catch (error) {
    return failed(error, "The deposit address was not changed.");
  }
}

/* -------------------------------------------------------------------------- */
/* Withdrawals                                                                 */
/* -------------------------------------------------------------------------- */

function refreshWithdrawals() {
  revalidate("/admin/withdrawals", "/admin", "/wallet", "/wallet/transactions", "/");
}

export async function approveWithdrawalAction(input: {
  withdrawalId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("withdrawals");
    await trackPipeline(
      {
        pipeline: "withdrawal",
        operation: "withdrawal.approve",
        message: "Operator approved a payout request",
        actor: operator.actor,
        subject: { type: "withdrawal", id: input.withdrawalId },
      },
      () =>
        approveWithdrawal(
          { withdrawalId: input.withdrawalId, note: input.note },
          operator.actor,
        ),
    );
    refreshWithdrawals();
    return { ok: true, message: "Withdrawal approved for payout." };
  } catch (error) {
    return failed(error, "The withdrawal was not changed.");
  }
}

export async function rejectWithdrawalAction(input: {
  withdrawalId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("withdrawals");
    const reason = requireReason(input.reason, "reject a withdrawal");
    // Returns the held balance as its own ledger entry, so the history shows
    // the hold and its reversal rather than a balance that silently returned.
    await trackPipeline(
      {
        pipeline: "withdrawal",
        operation: "withdrawal.reject",
        message: "Operator rejected a payout request; held funds returned",
        actor: operator.actor,
        subject: { type: "withdrawal", id: input.withdrawalId },
      },
      () =>
        rejectWithdrawal(
          { withdrawalId: input.withdrawalId, reason },
          operator.actor,
        ),
    );
    refreshWithdrawals();
    return { ok: true, message: "Withdrawal rejected and funds returned." };
  } catch (error) {
    return failed(error, "The withdrawal was not changed.");
  }
}

export async function markWithdrawalPaidAction(input: {
  withdrawalId: string;
  payoutReference?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("withdrawals");
    await markWithdrawalPaid(
      {
        withdrawalId: input.withdrawalId,
        payoutReference: input.payoutReference,
      },
      operator.actor,
    );
    refreshWithdrawals();
    return { ok: true, message: "Marked as paid." };
  } catch (error) {
    return failed(error, "The withdrawal was not changed.");
  }
}

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

function refreshUsers() {
  revalidate("/admin/users", "/admin");
}

export async function setUserStatusAction(input: {
  userId: string;
  status: AdminUserStatus;
  reason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("users");
    await setUserStatus(
      { userId: input.userId, status: input.status, reason: input.reason },
      operator.actor,
    );
    refreshUsers();
    return { ok: true, message: `Account set to ${input.status}.` };
  } catch (error) {
    return failed(error, "The account was not changed.");
  }
}

export async function setUserRestrictionAction(input: {
  userId: string;
  key: keyof AdminUserRestrictions;
  value: boolean;
  reason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("users");
    await setUserRestriction(
      {
        userId: input.userId,
        key: input.key,
        value: input.value,
        reason: input.reason,
      },
      operator.actor,
    );
    refreshUsers();
    return {
      ok: true,
      message: input.value ? "Restriction applied." : "Restriction lifted.",
    };
  } catch (error) {
    return failed(error, "The restriction was not changed.");
  }
}

export async function updateUserAction(input: {
  userId: string;
  changes: Partial<{
    fullName: string;
    phone: string;
    country: string;
    internalNote: string | null;
  }>;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("user_details");
    // `email` is deliberately absent from what an operator may change. It is
    // the Supabase sign-in identifier; rewriting it here would leave the two
    // authorities disagreeing and could re-point an account at a mailbox
    // nobody has proved control of.
    await updateUserProfile(
      { userId: input.userId, changes: input.changes },
      operator.actor,
    );
    refreshUsers();
    return { ok: true, message: "Profile updated." };
  } catch (error) {
    return failed(error, "The profile was not updated.");
  }
}

export async function revokeUserSessionAction(input: {
  userId: string;
  sessionId?: string;
  reason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("security");
    const { revoked, phoneSessionsEnded } = await revokeDeviceSessions(
      { userId: input.userId, sessionId: input.sessionId, reason: input.reason },
      operator.actor,
    );
    refreshUsers();
    return {
      ok: true,
      // Deliberately precise. "All devices" really ends every phone-OTP
      // session (the account's session epoch moves). Marking one device row
      // revoked does not, and neither invalidates a legacy Supabase email
      // session — that needs a service-role credential this application does
      // not hold. An operator who believes an account has been secured when
      // it has not is worse off than one who knows exactly what happened.
      message: phoneSessionsEnded
        ? `Signed the account out of every mobile-number session on every device` +
          (revoked > 0 ? ` and marked ${revoked} device record${revoked === 1 ? "" : "s"} revoked` : "") +
          ". A legacy email sign-in, if any, is not invalidated."
        : revoked === 0
          ? "No active sessions to revoke."
          : `Marked ${revoked} session${revoked === 1 ? "" : "s"} revoked. The credential itself is not invalidated.`,
    };
  } catch (error) {
    return failed(error, "The sessions were not changed.");
  }
}

/**
 * Emails the account a password reset link.
 *
 * Supabase sends it and Supabase validates it. The operator never sees, sets or
 * learns a password, and this application has no column that could hold one —
 * an operations console that could reveal or choose a customer's password is a
 * breach waiting for an insider.
 *
 * The user's current password keeps working until they use the link, so this is
 * safe to run on a support call without locking anybody out.
 */
export async function sendUserPasswordResetAction(input: {
  userId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("security");

    const db = getDb();
    const [user] = await db
      .select({ id: t.users.id, email: t.users.email, name: t.users.fullName })
      .from(t.users)
      .where(eq(t.users.id, input.userId))
      .limit(1);
    if (!user) throw new Error("That account no longer exists.");
    if (!user.email) {
      throw Object.assign(
        new Error(
          "This account signs in with a mobile number and has no password or email to reset.",
        ),
        { name: "AdminValidationError" },
      );
    }
    const email = user.email;
    if (!isLegacyEmailSignInEnabled()) {
      throw Object.assign(
        new Error(
          "Customer email sign-in is switched off — customers sign in with a mobile number, so a password reset would not help them.",
        ),
        { name: "AdminValidationError" },
      );
    }

    // Deliberately not the request-scoped client: this acts on the *user's*
    // email, not on the operator's own session.
    const redirectTo = `${await originForEmails()}/auth/callback?next=/update-password`;
    await trackPipeline(
      {
        pipeline: "email",
        operation: "email.password_recovery",
        message: "Requested a password reset email for a user",
        userId: user.id,
        actor: operator.actor,
        subject: { type: "user", id: user.id },
      },
      () =>
        sendPasswordRecovery(requireSupabaseConfig(), {
          email,
          redirectTo,
        }),
    );

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      await tx
        .update(t.users)
        .set({ updatedAt: now })
        .where(eq(t.users.id, user.id));

      await tx.insert(t.userSecurityEvents).values({
        id: newId("sec", now),
        userId: user.id,
        type: "password_changed",
        description: "A password reset link was sent by an operator",
        device: "—",
        ipAddress: "0.0.0.0",
        location: "Unknown",
        createdAt: now,
        outcome: "success",
      });

      audit({
        action: "user_password_reset",
        target: { type: "user", id: user.id, label: user.name },
        details: withReason(
          `Sent a password reset link to ${user.email}. Their current password still works until it is used.`,
          input.note,
        ),
      });
    });

    refreshUsers();
    return { ok: true, message: `Reset link sent to ${user.email}.` };
  } catch (error) {
    return failed(error, "The reset link was not sent.");
  }
}

/**
 * Clears the account's second-factor preferences.
 *
 * Narrow on purpose, because the flags are narrow: nothing in this build
 * challenges for a second factor, so these columns are preferences rather than
 * enrolments. Clearing them is what an operator can honestly do today, and the
 * audit line says exactly that rather than implying an enrolment was revoked.
 */
export async function resetUserTwoFactorAction(input: {
  userId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("security");
    const reason = requireReason(input.reason, "reset two-factor authentication");

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const [user] = await tx
        .select({ id: t.users.id, name: t.users.fullName })
        .from(t.users)
        .where(eq(t.users.id, input.userId))
        .limit(1)
        .for("update");
      if (!user) throw new Error("That account no longer exists.");

      await tx
        .update(t.users)
        .set({
          twoFactorEnabled: false,
          googleAuthEnabled: false,
          updatedAt: now,
        })
        .where(eq(t.users.id, user.id));

      await tx.insert(t.userSecurityEvents).values({
        id: newId("sec", now),
        userId: user.id,
        type: "two_factor_changed",
        description: "Two-factor preferences were cleared by an operator",
        device: "—",
        ipAddress: "0.0.0.0",
        location: "Unknown",
        createdAt: now,
        outcome: "success",
      });

      audit({
        action: "user_two_factor_reset",
        target: { type: "user", id: user.id, label: user.name },
        details: withReason(
          "Cleared two-factor preferences. No credential enrolment exists to revoke in this build.",
          reason,
        ),
      });
    });

    refreshUsers();
    return { ok: true, message: "Two-factor preferences cleared." };
  } catch (error) {
    return failed(error, "The account was not changed.");
  }
}

/* -------------------------------------------------------------------------- */
/* Plans                                                                       */
/* -------------------------------------------------------------------------- */

export interface PlanInput {
  name: string;
  tagline: string;
  description: string;
  minInvestment: number;
  maxInvestment: number;
  durationDays: number;
  estimatedReturnPercent: number;
  /** Ignored: kept for the form's shape. The stored range mirrors the rate. */
  estimatedReturnRange?: [number, number];
  rewardFrequency: (typeof t.rewardFrequencyEnum.enumValues)[number];
  risk: (typeof t.riskLevelEnum.enumValues)[number];
  status: (typeof t.planStatusEnum.enumValues)[number];
}

function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function validatePlan(input: PlanInput) {
  if (input.name.trim().length < 2) throw new Error("Give the plan a name.");
  if (input.minInvestment <= 0) throw new Error("The minimum must be above zero.");
  if (input.maxInvestment < input.minInvestment) {
    throw new Error("The maximum cannot be below the minimum.");
  }
  if (input.durationDays < 0) throw new Error("The term cannot be negative.");
  if (!(input.estimatedReturnPercent > 0)) throw new Error("The return must be above zero.");
}

export async function createPlanAction(
  input: PlanInput,
): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("plans");
    validatePlan(input);

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const id = newId("plan", now);
      await tx.insert(t.plans).values({
        id,
        slug: `${slugify(input.name)}-${id.slice(-6)}`,
        name: input.name.trim(),
        tagline: input.tagline.trim(),
        description: input.description.trim(),
        minInvestment: input.minInvestment,
        maxInvestment: input.maxInvestment,
        durationDays: input.durationDays,
        estimatedReturnPercent: input.estimatedReturnPercent,
        // One return figure per plan: the legacy range columns mirror it.
        estimatedReturnLow: input.estimatedReturnPercent,
        estimatedReturnHigh: input.estimatedReturnPercent,
        rewardFrequency: input.rewardFrequency,
        risk: input.risk,
        status: input.status,
        // The plan catalogue's standing early-exit wording. Not operator-
        // editable here: it is a contractual statement, and a free-text box in
        // a CRM form is the wrong place to change one.
        earlyExit: "Early exit is not available before maturity.",
        createdAt: now,
        updatedAt: now,
      });

      // The opening entry in the rate's own history — no "before" to record,
      // but the row it establishes is what every later change is a change
      // *from*.
      await tx.insert(t.planRateHistory).values({
        id: newId("prh", now),
        planId: id,
        previousRatePercent: null,
        newRatePercent: input.estimatedReturnPercent,
        effectiveAt: now,
        changedByActorId: operator.actor.id,
        changedByLabel: operator.actor.name,
        createdAt: now,
      });

      audit({
        action: "plan_created",
        target: { type: "plan", id, label: input.name.trim() },
        details: `Created ${input.name.trim()}.`,
      });
    });

    // The public catalogue reads the same rows, so it moves with the CRM.
    revalidate("/admin/plans", "/admin", "/plans");
    // The user-facing catalogue is cached across requests by tag, which a
    // path revalidation does not reach. Without this an operator's edit
    // would be invisible to users behind the TTL.
    revalidateCatalogue();
    return { ok: true, message: "Plan created." };
  } catch (error) {
    return failed(error, "The plan was not created.");
  }
}

export async function updatePlanAction(input: {
  planId: string;
  plan: PlanInput;
  /** Why the rate changed, if it did. Recorded on the rate-history row only. */
  rateChangeReason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("plans");
    validatePlan(input.plan);

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const [before] = await tx
        .select({ estimatedReturnPercent: t.plans.estimatedReturnPercent })
        .from(t.plans)
        .where(eq(t.plans.id, input.planId))
        .limit(1)
        .for("update");

      if (!before) throw new Error("That plan no longer exists.");

      const updated = await tx
        .update(t.plans)
        .set({
          name: input.plan.name.trim(),
          tagline: input.plan.tagline.trim(),
          description: input.plan.description.trim(),
          minInvestment: input.plan.minInvestment,
          maxInvestment: input.plan.maxInvestment,
          durationDays: input.plan.durationDays,
          estimatedReturnPercent: input.plan.estimatedReturnPercent,
          // One return figure per plan: the legacy range columns mirror it.
          estimatedReturnLow: input.plan.estimatedReturnPercent,
          estimatedReturnHigh: input.plan.estimatedReturnPercent,
          rewardFrequency: input.plan.rewardFrequency,
          risk: input.plan.risk,
          status: input.plan.status,
          updatedAt: now,
        })
        .where(eq(t.plans.id, input.planId))
        .returning({ id: t.plans.id });

      if (updated.length === 0) throw new Error("That plan no longer exists.");

      /*
       * The rate's own history, written only when the rate actually moved.
       *
       * `investments` already copies `projected_profit` onto each allocation
       * at the moment it is created (CLAUDE.md §10a), so this edit never
       * touches a running allocation's schedule — this row exists so the
       * *change itself* — who, when, from what, to what — survives, rather
       * than being recoverable only by reading `audit_logs.details` as prose.
       * See the comment on `plan_rate_history` in `db/schema/plans.ts`.
       */
      if (before.estimatedReturnPercent !== input.plan.estimatedReturnPercent) {
        await tx.insert(t.planRateHistory).values({
          id: newId("prh", now),
          planId: input.planId,
          previousRatePercent: before.estimatedReturnPercent,
          newRatePercent: input.plan.estimatedReturnPercent,
          effectiveAt: now,
          changedByActorId: operator.actor.id,
          changedByLabel: operator.actor.name,
          reason: input.rateChangeReason?.trim() || null,
          createdAt: now,
        });
      }

      // Existing allocations keep the terms they were sold under: their rows
      // copied the plan's name and rates at creation and are not rewritten.
      audit({
        action: "plan_updated",
        target: { type: "plan", id: input.planId, label: input.plan.name.trim() },
        details:
          before.estimatedReturnPercent !== input.plan.estimatedReturnPercent
            ? `Updated ${input.plan.name.trim()}. Rate changed from ` +
              `${before.estimatedReturnPercent}% to ${input.plan.estimatedReturnPercent}%, ` +
              `effective immediately for new allocations. Existing allocations keep their original terms.`
            : `Updated ${input.plan.name.trim()}. Existing allocations keep their original terms.`,
      });
    });

    revalidate("/admin/plans", "/admin", "/plans");
    // The user-facing catalogue is cached across requests by tag, which a
    // path revalidation does not reach. Without this an operator's edit
    // would be invisible to users behind the TTL.
    revalidateCatalogue();
    return { ok: true, message: "Plan updated." };
  } catch (error) {
    return failed(error, "The plan was not updated.");
  }
}

export async function setPlanDisabledAction(input: {
  planId: string;
  disabled: boolean;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("plans");

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const [plan] = await tx
        .select({ id: t.plans.id, name: t.plans.name })
        .from(t.plans)
        .where(eq(t.plans.id, input.planId))
        .limit(1)
        .for("update");
      if (!plan) throw new Error("That plan no longer exists.");

      await tx
        .update(t.plans)
        .set({ status: input.disabled ? "disabled" : "open", updatedAt: now })
        .where(eq(t.plans.id, input.planId));

      audit({
        action: input.disabled ? "plan_disabled" : "plan_enabled",
        target: { type: "plan", id: plan.id, label: plan.name },
        details: withReason(
          input.disabled
            ? `Disabled ${plan.name}. It no longer appears in the public catalogue.`
            : `Enabled ${plan.name}.`,
          input.note,
        ),
      });
    });

    revalidate("/admin/plans", "/admin", "/plans");
    // The user-facing catalogue is cached across requests by tag, which a
    // path revalidation does not reach. Without this an operator's edit
    // would be invisible to users behind the TTL.
    revalidateCatalogue();
    return {
      ok: true,
      message: input.disabled ? "Plan disabled." : "Plan enabled.",
    };
  } catch (error) {
    return failed(error, "The plan was not changed.");
  }
}

/* -------------------------------------------------------------------------- */
/* Agents                                                                      */
/* -------------------------------------------------------------------------- */

async function writePermissions(
  tx: Parameters<Parameters<typeof mutate>[1]>[0]["tx"],
  agentId: string,
  permissions: AdminPermissionSet,
) {
  for (const [permission, level] of Object.entries(permissions)) {
    await tx
      .insert(t.adminAgentPermissions)
      .values({
        agentId,
        permission: permission as keyof AdminPermissionSet,
        level,
      })
      .onConflictDoUpdate({
        target: [
          t.adminAgentPermissions.agentId,
          t.adminAgentPermissions.permission,
        ],
        set: { level },
      });
  }
}

/**
 * The operator's sign-in number, validated. Thrown as a validation error, so
 * the message reaches the form.
 */
function operatorPhone(raw: string | undefined): string {
  const phone = normalizeIndianMobile(String(raw ?? ""));
  if (!phone) {
    throw Object.assign(new Error("Enter the operator's 10-digit Indian mobile number."), {
      name: "AdminValidationError",
    });
  }
  return phone;
}

/**
 * An operator's console access code, validated and hashed — or null when the
 * form left it blank (edit only). The plain code is never stored, logged,
 * audited or returned.
 */
async function hashedAccessCode(raw: string | undefined, required: boolean): Promise<string | null> {
  const code = String(raw ?? "").trim();
  if (code === "" && !required) return null;
  if (!/^[A-Za-z0-9]{10}$/.test(code)) {
    throw Object.assign(new Error("The access code must be exactly 10 letters and digits."), {
      name: "AdminValidationError",
    });
  }
  return hashPassword(code);
}

/** A unique-index violation on an operator's phone or email, said plainly. */
function rethrowPhoneConflict(error: unknown): never {
  const text = describeError(error);
  if (/admin_agents_phone_e164_key/.test(text)) {
    throw Object.assign(new Error("That mobile number is already registered to another operator."), {
      name: "AdminValidationError",
    });
  }
  if (/admin_agents_email_unique/.test(text)) {
    throw Object.assign(new Error("That email address is already used by another operator."), {
      name: "AdminValidationError",
    });
  }
  throw error;
}

export async function createAgentAction(input: {
  name: string;
  email: string;
  phone: string;
  accessCode?: string;
  permissions: AdminPermissionSet;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");
    if (input.name.trim().length < 2) throw new Error("Give the operator a name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new Error("Enter a valid work email address.");
    }
    const phone = operatorPhone(input.phone);
    const accessCodeHash = await hashedAccessCode(input.accessCode, true);

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const id = newId("agt", now);
      await tx.insert(t.adminAgents).values({
        id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: "agent",
        // `invited` until the operator proves the number by SMS on their first
        // sign-in; the number is an authorization, not yet a credential.
        status: "invited",
        phoneE164: phone,
        accessCodeHash,
        createdAt: now,
        note: input.note?.trim() || null,
      }).catch(rethrowPhoneConflict);

      await writePermissions(tx, id, input.permissions);

      audit({
        action: "agent_created",
        target: { type: "agent", id, label: input.name.trim() },
        details: `Invited ${input.name.trim()} to sign in with ${maskIndianMobile(phone)} and an access code.`,
      });
    });

    revalidate("/admin/agents", "/admin");
    return {
      ok: true,
      message: "Operator invited. They sign in with their mobile number, the access code you set, and an SMS code.",
    };
  } catch (error) {
    return failed(error, "The operator was not created.");
  }
}

export async function updateAgentAction(input: {
  agentId: string;
  name: string;
  email: string;
  /** A new sign-in number, or empty to keep the current one. */
  phone?: string;
  /** A new access code, or empty to keep the current one. */
  accessCode?: string;
  permissions: AdminPermissionSet;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");
    const newPhone = input.phone?.trim() ? operatorPhone(input.phone) : null;
    const newAccessCodeHash = await hashedAccessCode(input.accessCode, false);

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      void now;
      const [current] = await tx
        .select({ phoneE164: t.adminAgents.phoneE164, role: t.adminAgents.role })
        .from(t.adminAgents)
        .where(eq(t.adminAgents.id, input.agentId))
        .limit(1)
        .for("update");
      if (!current) throw new Error("That operator no longer exists.");
      // A master admin's credentials are changed only by a master admin.
      if (
        current.role === "master_admin" &&
        operator.role !== "master_admin" &&
        (newPhone !== null || newAccessCodeHash !== null)
      ) {
        throw Object.assign(
          new Error("Only a master admin can change a master admin's number or access code."),
          { name: "AdminValidationError" },
        );
      }
      const phoneChanged = newPhone !== null && newPhone !== current.phoneE164;

      await tx
        .update(t.adminAgents)
        .set({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          note: input.note?.trim() || null,
          // A new number is a new authorization: the old binding is cleared
          // and every session the operator holds ends, so the next sign-in
          // must prove the new number.
          ...(phoneChanged
            ? {
                phoneE164: newPhone,
                firebaseUid: null,
                phoneVerifiedAt: null,
                sessionEpoch: sql`${t.adminAgents.sessionEpoch} + 1`,
              }
            : {}),
          ...(newAccessCodeHash ? { accessCodeHash: newAccessCodeHash } : {}),
        })
        .where(eq(t.adminAgents.id, input.agentId))
        .catch(rethrowPhoneConflict);

      await writePermissions(tx, input.agentId, input.permissions);

      audit({
        action: "agent_permissions_changed",
        target: { type: "agent", id: input.agentId, label: input.name.trim() },
        details:
          (phoneChanged
            ? `Updated ${input.name.trim()} and their permissions; sign-in number changed to ${maskIndianMobile(newPhone)} and their sessions ended.`
            : `Updated ${input.name.trim()} and their permissions.`) +
          (newAccessCodeHash ? " Access code replaced." : ""),
      });
    });

    revalidate("/admin/agents", "/admin");
    return { ok: true, message: "Operator updated." };
  } catch (error) {
    return failed(error, "The operator was not updated.");
  }
}

export async function setAgentDisabledAction(input: {
  agentId: string;
  disabled: boolean;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");

    // An operator disabling themselves locks the console behind whoever else
    // holds `agents: manage` — which might be nobody.
    if (input.disabled && input.agentId === operator.agentId) {
      throw new Error("You cannot disable your own operator account.");
    }

    await mutate(operator.actor, async ({ tx, audit }) => {
      const [agent] = await tx
        .select({ id: t.adminAgents.id, name: t.adminAgents.name })
        .from(t.adminAgents)
        .where(eq(t.adminAgents.id, input.agentId))
        .limit(1)
        .for("update");
      if (!agent) throw new Error("That operator no longer exists.");

      await tx
        .update(t.adminAgents)
        .set({ status: input.disabled ? "disabled" : "active" })
        .where(eq(t.adminAgents.id, input.agentId));

      audit({
        action: input.disabled ? "agent_disabled" : "agent_enabled",
        target: { type: "agent", id: agent.id, label: agent.name },
        details: withReason(
          input.disabled
            ? `Disabled ${agent.name}. Their session is refused on the next request.`
            : `Enabled ${agent.name}.`,
          input.note,
        ),
      });
    });

    revalidate("/admin/agents", "/admin");
    return {
      ok: true,
      message: input.disabled ? "Operator disabled." : "Operator enabled.",
    };
  } catch (error) {
    return failed(error, "The operator was not changed.");
  }
}

/**
 * Ends every session an operator holds, on every device.
 *
 * Operators sign in by SMS, so there is no password to reset; what a lost or
 * shared phone calls for is this — the operator's `session_epoch` moves, and
 * every operator cookie issued before now stops resolving on its next request.
 * To stop them signing in again, disable them or change their number.
 */
export async function endAgentSessionsAction(input: {
  agentId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");

    const name = await mutate(operator.actor, async ({ tx, audit }) => {
      const [agent] = await tx
        .update(t.adminAgents)
        .set({ sessionEpoch: sql`${t.adminAgents.sessionEpoch} + 1` })
        .where(eq(t.adminAgents.id, input.agentId))
        .returning({ id: t.adminAgents.id, name: t.adminAgents.name });
      if (!agent) throw new Error("That operator no longer exists.");

      audit({
        action: "agent_updated",
        target: { type: "agent", id: agent.id, label: agent.name },
        details: withReason(`Ended every session ${agent.name} held.`, input.note),
      });
      return agent.name;
    });

    revalidate("/admin/agents");
    return { ok: true, message: `${name} is signed out on every device.` };
  } catch (error) {
    return failed(error, "The sessions were not ended.");
  }
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export async function sendNotificationAction(input: {
  title: string;
  body: string;
  audience: (typeof t.notificationAudienceEnum.enumValues)[number];
  targetUserLabel: string | null;
  channels: (typeof t.notificationChannelEnum.enumValues)[number][];
  templateId: (typeof t.notificationTemplateEnum.enumValues)[number];
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("notifications");
    if (input.title.trim().length < 2) throw new Error("Give the message a title.");
    if (input.body.trim().length < 2) throw new Error("The message body is empty.");
    if (input.channels.length === 0) throw new Error("Choose at least one channel.");

    const recipients = await mutate(operator.actor, async ({ tx, now, audit }) => {
      // Resolve the audience to real accounts. The campaign's reach used to be
      // a lookup table of made-up numbers; it is now a count of the rows that
      // were actually written.
      const targets = await tx
        .select({ id: t.users.id, kycStatus: t.users.kycStatus, status: t.users.status })
        .from(t.users);

      const matches = targets.filter((user) => {
        switch (input.audience) {
          case "all_users":
            return true;
          case "kyc_pending":
            return user.kycStatus === "pending_review" || user.kycStatus === "in_progress";
          case "kyc_approved":
            return user.kycStatus === "verified";
          case "blocked_users":
            return user.status === "blocked";
          case "inactive_users":
            return user.status === "inactive";
          // `single_user`, `active_investors` and `vip` need a join this
          // composer does not collect enough input to build, so they address
          // nobody rather than quietly addressing everybody.
          default:
            return false;
        }
      });

      const campaignId = newId("cmp", now);
      await tx.insert(t.notificationCampaigns).values({
        id: campaignId,
        title: input.title.trim(),
        body: input.body.trim(),
        audience: input.audience,
        targetUserLabel: input.targetUserLabel,
        channels: input.channels,
        templateId: input.templateId,
        sentAt: now,
        sentBy: operator.name,
        recipientCount: matches.length,
        status: "sent",
      });

      if (matches.length > 0) {
        await tx.insert(t.notifications).values(
          matches.map((user) => ({
            id: newId("ntf", now),
            userId: user.id,
            category: "announcement" as const,
            title: input.title.trim(),
            body: input.body.trim(),
            createdAt: now,
            read: false,
          })),
        );
      }

      audit({
        action: "notification_sent",
        target: { type: "notification", id: campaignId, label: input.title.trim() },
        details: `Sent "${input.title.trim()}" to ${matches.length} account${matches.length === 1 ? "" : "s"}.`,
      });

      return matches.length;
    });

    /*
     * `/` and `/settings` as well as the notifications screen.
     *
     * A campaign lands in the recipient's notification list, and that list is
     * read by `TopBar` — the unread badge on *every* user page — and by Home.
     * Revalidating only `/settings/notifications` meant an operator sent a
     * notification, the row existed, and the person's bell stayed silent until
     * they happened to open the one screen that had been invalidated.
     */
    revalidate(
      "/admin/notifications",
      "/admin",
      "/settings/notifications",
      "/settings",
      "/",
    );
    return {
      ok: true,
      // In-app only. There is no email or push delivery, and saying "sent" for
      // a channel nothing transmits on would be a lie the operator acts on.
      message:
        recipients === 0
          ? "Recorded. No accounts matched that audience."
          : `Delivered in-app to ${recipients} account${recipients === 1 ? "" : "s"}.`,
    };
  } catch (error) {
    return failed(error, "The notification was not sent.");
  }
}

/* -------------------------------------------------------------------------- */
/* Settings                                                                    */
/* -------------------------------------------------------------------------- */

export async function updateSettingsAction(input: {
  settings: PlatformSettings;
  summary: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("settings");

    // Shown to customers as where to write for help, so it is held to the same
    // rule on the way in as on the way out (`getSupportEmail`).
    const supportEmail = input.settings.platform.supportEmail?.trim() ?? "";
    if (supportEmail && !parseSupportEmail(supportEmail)) {
      return { ok: false, message: "Enter a valid support email address, or leave it empty." };
    }

    // The money settings decide what customers are quoted and paid, so they
    // are validated here whatever the form allowed.
    const financeRefusal = financeSettingsRefusal({
      displayRate: input.settings.currency?.displayRate,
      payoutRate: input.settings.currency?.payoutRate,
      flatFeeUsdt: input.settings.withdrawals?.flatFeeUsdt,
      percentFee: input.settings.withdrawals?.percentFee,
    });
    if (financeRefusal) return { ok: false, message: financeRefusal };
    const minimumWithdrawal = input.settings.withdrawals.minimumUsdt;
    if (!Number.isFinite(minimumWithdrawal) || minimumWithdrawal <= 0 || minimumWithdrawal > 1_000_000) {
      return { ok: false, message: "The minimum withdrawal must be a positive amount." };
    }

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const [existing] = await tx
        .select({ id: t.platformSettings.id })
        .from(t.platformSettings)
        .limit(1);
      if (!existing) throw new Error("Platform settings have not been initialised.");

      // The support Telegram username is not this form's to write: it has its
      // own validated action below. Anything the client put under that key is
      // dropped, and the stored value is carried over in SQL, so saving the
      // general form can neither clear it nor smuggle in an unvalidated one.
      const platform: StoredPlatformSection = { ...input.settings.platform };
      delete platform.supportTelegram;
      platform.supportEmail = supportEmail;

      // Stored as one jsonb column per section, matching the shape the CRM
      // edits and the services read. Written whole: the form submits the
      // complete settings object, so a partial update could only ever mean a
      // section the operator did not see was left behind.
      await tx
        .update(t.platformSettings)
        .set({
          platform: sql`${JSON.stringify(platform)}::jsonb || jsonb_strip_nulls(jsonb_build_object('supportTelegram', ${t.platformSettings.platform}->'supportTelegram'))`,
          currency: input.settings.currency,
          withdrawals: input.settings.withdrawals,
          deposits: input.settings.deposits,
          investments: input.settings.investments,
          referrals: input.settings.referrals,
          security: input.settings.security,
          updatedAt: now,
          updatedBy: operator.name,
        })
        .where(eq(t.platformSettings.id, existing.id));

      audit({
        action: "settings_updated",
        target: { type: "settings", id: existing.id, label: "Platform settings" },
        details: input.summary,
      });
    });

    revalidateCatalogue();
    revalidate("/admin/settings", "/admin", "/settings/support");
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return failed(error, "The settings were not saved.");
  }
}

/**
 * Sets, or clears, where customers contact support on Telegram.
 *
 * The one write path for `platform_settings.platform.supportTelegram`, which
 * Settings → Support and the deposit screen both read. Validated here and
 * again when read (`getSupportTelegramUrl`): only a Telegram username is
 * stored, never a URL, so the customer's button can only ever open `t.me`.
 * An empty value clears it and customers see the unavailable state.
 */
export async function updateSupportTelegramAction(input: {
  telegram: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("settings");

    const raw = typeof input?.telegram === "string" ? input.telegram.trim() : "";
    const username = raw ? parseTelegramUsername(raw) : null;
    if (raw && !username) {
      return {
        ok: false,
        message:
          "Enter a Telegram link (https://t.me/…), a username (5–32 letters, digits or underscores) or a group invite link.",
      };
    }

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const [existing] = await tx
        .select({
          id: t.platformSettings.id,
          previous: sql<string | null>`${t.platformSettings.platform}->>'supportTelegram'`,
        })
        .from(t.platformSettings)
        .limit(1)
        .for("update");
      if (!existing) throw new Error("Platform settings have not been initialised.");

      await tx
        .update(t.platformSettings)
        .set({
          platform: username
            ? sql`jsonb_set(${t.platformSettings.platform}, '{supportTelegram}', to_jsonb(${username}::text))`
            : sql`${t.platformSettings.platform} - 'supportTelegram'`,
          updatedAt: now,
          updatedBy: operator.name,
        })
        .where(eq(t.platformSettings.id, existing.id));

      audit({
        action: "settings_updated",
        target: { type: "settings", id: existing.id, label: "Customer support" },
        details: username
          ? `Support Telegram set to ${telegramLabel(username)}${existing.previous ? ` (was ${telegramLabel(existing.previous)})` : ""}.`
          : `Support Telegram cleared${existing.previous ? ` (was ${telegramLabel(existing.previous)})` : ""}.`,
      });
    });

    revalidateCatalogue();
    revalidate("/admin/settings", "/settings", "/settings/support", "/wallet/deposit");
    return {
      ok: true,
      message: username ? `Customers now reach ${telegramLabel(username)} on Telegram.` : "Telegram support cleared.",
    };
  } catch (error) {
    return failed(error, "The support setting was not saved.");
  }
}

/* -------------------------------------------------------------------------- */
/* Referrals                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Pays a pending referral commission into the beneficiary's wallet.
 *
 * `/admin/referrals` had no actions at all: it listed referral accounts and a
 * commission ledger and offered no way to do anything about either. Commission
 * therefore accrued `pending` and stayed there for ever, which meant the
 * referral programme the product describes to users — "you earn commission,
 * credited to your available balance" — had no path to its own last step.
 *
 * This is the same shape as every other movement of money in this console: a
 * permission check, one transaction, a ledger row, an audit entry. It moves
 * real money, so it is gated on `manage` over `referrals`.
 */
export async function releaseCommissionAction(input: {
  commissionEntryId: string;
  note?: string;
}): Promise<AdminActionResult> {
  return traceAction(
    // `admin` rather than a new `referral` pipeline value: `pipeline_enum` is a
    // Postgres enum, and adding a label to it is a migration. A log category is
    // not worth one, and this genuinely is an operator action in the console.
    { name: "admin.referral.release", actorType: "admin", pipeline: "admin" },
    async () => {
      try {
        const operator = await requirePermission("referrals");
        const { amount, beneficiaryUserId } = await trackPipeline(
          {
            pipeline: "admin",
            operation: "referral.commission.release",
            message: "Operator released a pending referral commission",
            actor: operator.actor,
            subject: { type: "commission", id: input.commissionEntryId },
          },
          () =>
            releaseCommission(
              {
                commissionEntryId: input.commissionEntryId,
                note: input.note,
              },
              operator.actor,
            ),
        );

        // The beneficiary's own screens are the other half of this write: their
        // balance, their ledger and their referral standing all changed.
        revalidate(
          "/admin/referrals",
          "/admin",
          "/referral",
          "/wallet",
          "/wallet/transactions",
          "/",
        );
        void beneficiaryUserId;
        return { ok: true, message: `Released ${amount} USDT.` };
      } catch (error) {
        return failed(error, "The commission was not released.");
      }
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Plan rate tiers                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Saves a plan's whole rate ladder.
 *
 * `manage` over `plans`, the same grant that edits the plan itself — a band's
 * percentage is the plan's commercial terms by another name, and splitting the
 * two permissions would let somebody without plan access reprice every
 * allocation made from tomorrow.
 *
 * The ladder is validated server-side in `savePlanRateTiers`, not here and not
 * in the form: the form's checks are an affordance, and this action is the
 * boundary an operator with a REST client would otherwise walk straight past.
 */
export async function savePlanTiersAction(input: {
  planId: string;
  tiers: TierDraft[];
  reason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("plans");
    const { saved } = await savePlanRateTiers(
      { planId: input.planId, tiers: input.tiers, reason: input.reason },
      operator.actor,
    );

    revalidate("/admin/plans", "/admin", "/plans");
    // The public catalogue is cached across requests by tag, which a path
    // revalidation does not reach (CLAUDE.md §16.9). Without this an operator's
    // tier edit sits invisible to customers behind the 300s TTL.
    revalidateCatalogue();
    return {
      ok: true,
      message:
        saved === 0
          ? "Tiers removed. The plan is priced at its own estimated return."
          : `${saved} tier${saved === 1 ? "" : "s"} saved. Existing allocations keep the rate they were sold at.`,
    };
  } catch (error) {
    return failed(error, "The tiers were not saved.");
  }
}

/**
 * Saves a plan's per-duration rates (7/15/30/60/90 days). `manage` over
 * `plans`, the same grant as the tier ladder, for the same reason: a rate is
 * the plan's commercial terms. Validated and audited in
 * `savePlanDurationRates`; existing allocations are never repriced.
 */
export async function savePlanDurationRatesAction(input: {
  planId: string;
  rates: DurationRateDraft[];
  reason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("plans");
    const { offered } = await savePlanDurationRates(
      { planId: input.planId, rates: input.rates, reason: input.reason },
      operator.actor,
    );
    revalidate("/admin/plans", "/admin", "/plans");
    revalidateCatalogue();
    return {
      ok: true,
      message:
        offered === 0
          ? "No durations offered. The plan is sold on its own single term."
          : `${offered} duration${offered === 1 ? "" : "s"} offered. Existing allocations keep the rate they were sold at.`,
    };
  } catch (error) {
    return failed(error, "The duration rates were not saved.");
  }
}

export interface TierPreviewResult {
  ok: boolean;
  message?: string;
  preview?: TierPreview;
}

/**
 * "What would this amount be sold at?" — answered by the pricing function
 * itself.
 *
 * `view` is enough: it reads configuration and computes, and changes nothing.
 * It deliberately calls `previewPlanRate`, which calls the same
 * `resolveRateForAmount` an allocation goes through — a preview computed in the
 * form would be a second implementation of the rule, and the only reason to
 * have a preview is to see what the *real* one does.
 */
export async function previewPlanTierAction(input: {
  planId: string;
  amount: string;
}): Promise<TierPreviewResult> {
  try {
    await requirePermission("plans", "view");
    const preview = await previewPlanRate(input.planId, input.amount.trim());
    return { ok: true, preview };
  } catch (error) {
    return {
      ok: false,
      message:
        error instanceof Error ? error.message : "Could not price that amount.",
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Manual USDT credit                                                          */
/* -------------------------------------------------------------------------- */

export interface ManualCreditLookupResult {
  ok: boolean;
  message: string;
  customer?: ManualCreditCustomer;
}

/**
 * Step one of a manual credit: who is this id?
 *
 * Gated on `manage` over `wallet_credits`, the same grant the credit itself
 * needs — the lookup exists only to confirm a credit, and an operator without
 * that grant has no reason to resolve customers through it. Returns the
 * customer's name, masked number and status so a mistyped id is caught on the
 * confirmation screen, before any money moves.
 */
export async function lookupCustomerForCreditAction(input: {
  customerId: string;
}): Promise<ManualCreditLookupResult> {
  try {
    await requirePermission("wallet_credits");
    const customer = await findCustomerForCredit(input?.customerId);
    if (!customer) {
      return { ok: false, message: "No customer has that id. Check it and try again." };
    }
    return { ok: true, message: "Customer found.", customer };
  } catch (error) {
    return failed(error, "The customer could not be looked up.");
  }
}

export interface ManualCreditActionResult extends AdminActionResult {
  creditId?: string;
  ledgerTxId?: string;
  duplicate?: boolean;
}

/**
 * Step two: credit the wallet.
 *
 * `manage` over `wallet_credits`, from the session — a master admin holds it by
 * role, an agent only when granted it explicitly (no preset grants it). The
 * customer, amount, note and idempotency key are all re-validated by the
 * service, which moves the money through the ledger in one transaction with
 * the decision record and the audit entry (`creditWalletManually`).
 */
export async function manualCreditAction(input: {
  userId: string;
  amount: string;
  note?: string;
  idempotencyKey: string;
  /** Manual Funds: "debit" removes funds (reason required); default credit. */
  direction?: "credit" | "debit";
}): Promise<ManualCreditActionResult> {
  return traceAction(
    { name: "admin.wallet.manual_credit", actorType: "admin", pipeline: "admin" },
    async () => {
      try {
        const operator = await requirePermission("wallet_credits");
        const result = await trackPipeline(
          {
            pipeline: "admin",
            operation: input?.direction === "debit" ? "wallet.manual_debit" : "wallet.manual_credit",
            message:
              input?.direction === "debit"
                ? "Operator debited USDT from a customer wallet by hand"
                : "Operator credited USDT to a customer wallet by hand",
            userId: String(input?.userId ?? ""),
            actor: operator.actor,
          },
          () =>
            creditWalletManually(
              {
                userId: String(input?.userId ?? ""),
                amount: String(input?.amount ?? ""),
                note: input?.note ?? null,
                idempotencyKey: String(input?.idempotencyKey ?? ""),
                // Validated again by the service; anything else is refused.
                direction: input?.direction,
              },
              operator.actor,
            ),
        );
        revalidate(
          "/admin/wallet-credits",
          `/admin/users/${result.userId}`,
          "/admin/audit-logs",
          "/wallet",
          "/wallet/transactions",
          "/",
        );
        return {
          ok: true,
          duplicate: result.duplicate,
          creditId: result.creditId,
          ledgerTxId: result.ledgerTxId,
          message: result.duplicate
            ? `Already applied: ${result.amountUsdt} USDT ${result.direction === "debit" ? "from" : "to"} ${result.displayId} (${result.creditId}). Nothing was changed again.`
            : `${result.direction === "debit" ? "Debited" : "Credited"} ${result.amountUsdt} USDT ${result.direction === "debit" ? "from" : "to"} ${result.displayId}. Reference ${result.creditId}` +
              (result.balanceAfterUsdt !== null ? `. Available balance now ${result.balanceAfterUsdt} USDT.` : "."),
        };
      } catch (error) {
        return failed(error, "The wallet was not changed.");
      }
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Withdrawal password                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Clears a customer's withdrawal password after support has confirmed who
 * they are. `manage` over `security` — the same grant that ends a customer's
 * sessions — and a reason is required: it is the record of how identity was
 * established, written into the audit entry in the same transaction.
 *
 * It does not set a password. The customer creates a new one themselves,
 * which needs a fresh SMS code to their verified number; nobody on the
 * operations side ever knows it.
 */
export async function resetWithdrawalPasswordAction(input: {
  userId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("security");
    const reason = requireReason(input?.reason, "reset a withdrawal password");
    await resetWithdrawalPassword({ userId: String(input?.userId ?? ""), reason }, operator.actor);
    revalidate(`/admin/users/${input.userId}`, "/admin/audit-logs", "/settings/security", "/wallet/withdraw");
    return {
      ok: true,
      message: "Withdrawal password reset. The customer must create a new one before withdrawing.",
    };
  } catch (error) {
    return failed(error, "The withdrawal password was not reset.");
  }
}

/* -------------------------------------------------------------------------- */
/* Support tickets                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Replying to, and changing the status of, a customer's support ticket.
 *
 * Gated on `users: manage` (viewing the queue is `users: view`): a ticket is a
 * customer conversation, and the people who may act on a customer's account are
 * the people who may answer them. Both are audited in the same transaction as
 * the change.
 */
export async function replyToTicketAsSupportAction(input: {
  ticketId: string;
  message: string;
  resolve?: boolean;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("users");
    await replyToTicketAsSupport(
      {
        ticketId: String(input?.ticketId ?? ""),
        message: String(input?.message ?? ""),
        resolve: input?.resolve === true,
      },
      operator.actor,
    );
    revalidate("/admin/tickets", `/admin/tickets/${input.ticketId}`, "/settings/support");
    return { ok: true, message: input.resolve ? "Reply sent and ticket resolved." : "Reply sent." };
  } catch (error) {
    return failed(error, "The reply was not sent.");
  }
}

export async function setTicketStatusAction(input: {
  ticketId: string;
  status: "open" | "awaiting_reply" | "resolved";
  reason?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("users");
    if (!["open", "awaiting_reply", "resolved"].includes(input?.status)) {
      return { ok: false, message: "Choose a valid status." };
    }
    await setTicketStatus(
      { ticketId: String(input.ticketId ?? ""), status: input.status, reason: input.reason },
      operator.actor,
    );
    revalidate("/admin/tickets", `/admin/tickets/${input.ticketId}`, "/settings/support");
    return { ok: true, message: "Ticket status updated." };
  } catch (error) {
    return failed(error, "The ticket was not updated.");
  }
}
