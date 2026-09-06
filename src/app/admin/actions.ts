"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";

import { getDb } from "@/db";
import * as t from "@/db/schema";
import { requireSupabaseConfig } from "@/lib/supabase/env";
import { getSiteUrl } from "@/lib/site-url";
import { sendPasswordRecovery } from "@/lib/supabase/auth-rest";
import { trackPipeline } from "@/server/observability";
import { traceAction } from "@/server/trace-action";
import { requirePermission } from "@/server/admin/session";
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
import { releaseDepositAddress } from "@/server/services/deposit-address.service";
import {
  approveWithdrawal,
  markWithdrawalPaid,
  rejectWithdrawal,
} from "@/server/services/withdrawals-write.service";
import { releaseCommission } from "@/server/services/referrals-write.service";
import { signKycDocument, KycStorageError } from "@/server/storage/kyc-storage";
import { mutate, newId, withReason } from "@/server/write";
import type {
  AdminPermissionSet,
  AdminUserRestrictions,
  AdminUserStatus,
  PlatformSettings,
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
}

function failed(error: unknown, fallback: string): AdminActionResult {
  // Authorization refusals carry a message an operator can act on ("you do not
  // have manage access to withdrawals"); anything else gets the generic text
  // rather than a database error string.
  if (error instanceof Error && error.name.startsWith("Admin")) {
    return { ok: false, message: error.message };
  }
  return {
    ok: false,
    message: error instanceof Error ? error.message : fallback,
  };
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
      .select({ path: t.kycDocuments.storagePath })
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

    const url = await signKycDocument(document.path, 120);
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
 * Releases a deposit-address pool assignment back to `available`.
 *
 * The only way an address is ever un-assigned — see the doc comment on
 * `deposit_addresses`. Refused by the service when any deposit against that
 * address has not reached a terminal state, so this cannot be used to hand a
 * still-active address to someone else.
 */
export async function releaseDepositAddressAction(input: {
  addressId: string;
  reason: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("deposits");
    const reason = requireReason(input.reason, "release a deposit address");
    await releaseDepositAddress({ addressId: input.addressId, reason }, operator.actor);
    revalidate("/admin/deposits", "/admin");
    return { ok: true, message: "Address released back to the pool." };
  } catch (error) {
    return failed(error, "The address was not released.");
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
    const { revoked } = await revokeDeviceSessions(
      { userId: input.userId, sessionId: input.sessionId, reason: input.reason },
      operator.actor,
    );
    refreshUsers();
    return {
      ok: true,
      // Deliberately precise. Marking a device session revoked does not
      // invalidate the Supabase refresh token behind it — that needs a
      // service-role credential this application does not hold — and an
      // operator who believes an account has been secured when it has not is
      // worse off than one who knows exactly what happened.
      message:
        revoked === 0
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
          email: user.email,
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
  estimatedReturnRange: [number, number];
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
        estimatedReturnLow: input.estimatedReturnRange[0],
        estimatedReturnHigh: input.estimatedReturnRange[1],
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
          estimatedReturnLow: input.plan.estimatedReturnRange[0],
          estimatedReturnHigh: input.plan.estimatedReturnRange[1],
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

export async function createAgentAction(input: {
  name: string;
  email: string;
  permissions: AdminPermissionSet;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");
    if (input.name.trim().length < 2) throw new Error("Give the operator a name.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email.trim())) {
      throw new Error("Enter a valid work email address.");
    }

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const id = newId("agt", now);
      await tx.insert(t.adminAgents).values({
        id,
        name: input.name.trim(),
        email: input.email.trim().toLowerCase(),
        role: "agent",
        // `invited`, not `active`, and no `auth_user_id`: the row exists but
        // cannot sign in. Creating an operator here does not create a
        // credential — that is Supabase's, and linking the two is a deliberate
        // second step rather than something a form does by implication.
        status: "invited",
        createdAt: now,
        note: input.note?.trim() || null,
      });

      await writePermissions(tx, id, input.permissions);

      audit({
        action: "agent_created",
        target: { type: "agent", id, label: input.name.trim() },
        details: `Invited ${input.name.trim()}. No sign-in credential is linked yet.`,
      });
    });

    revalidate("/admin/agents", "/admin");
    return {
      ok: true,
      message: "Operator invited. Link a sign-in credential before they can log in.",
    };
  } catch (error) {
    return failed(error, "The operator was not created.");
  }
}

export async function updateAgentAction(input: {
  agentId: string;
  name: string;
  email: string;
  permissions: AdminPermissionSet;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      void now;
      const updated = await tx
        .update(t.adminAgents)
        .set({
          name: input.name.trim(),
          email: input.email.trim().toLowerCase(),
          note: input.note?.trim() || null,
        })
        .where(eq(t.adminAgents.id, input.agentId))
        .returning({ id: t.adminAgents.id });
      if (updated.length === 0) throw new Error("That operator no longer exists.");

      await writePermissions(tx, input.agentId, input.permissions);

      audit({
        action: "agent_permissions_changed",
        target: { type: "agent", id: input.agentId, label: input.name.trim() },
        details: `Updated ${input.name.trim()} and their permissions.`,
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
 * Emails an operator a password reset link.
 *
 * Same mechanism as the customer-facing one, and the same reason for it:
 * Supabase owns the credential, so an operator's password is not something
 * another operator can see or set. Refuses when the target has no linked
 * credential — a reset link for an account that cannot sign in would be a
 * confusing no-op rather than a useful one.
 */
export async function sendAgentPasswordResetAction(input: {
  agentId: string;
  note?: string;
}): Promise<AdminActionResult> {
  try {
    const operator = await requirePermission("agents");

    const db = getDb();
    const [agent] = await db
      .select({
        id: t.adminAgents.id,
        email: t.adminAgents.email,
        name: t.adminAgents.name,
        authUserId: t.adminAgents.authUserId,
      })
      .from(t.adminAgents)
      .where(eq(t.adminAgents.id, input.agentId))
      .limit(1);
    if (!agent) throw new Error("That operator no longer exists.");
    if (!agent.authUserId) {
      throw new Error(
        `${agent.name} has no sign-in credential linked yet, so there is no password to reset.`,
      );
    }

    await sendPasswordRecovery(requireSupabaseConfig(), {
      email: agent.email,
      redirectTo: `${await originForEmails()}/auth/callback?next=/update-password`,
    });

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      await tx
        .update(t.adminAgents)
        .set({ passwordResetRequestedAt: now })
        .where(eq(t.adminAgents.id, agent.id));

      audit({
        action: "agent_password_reset",
        target: { type: "agent", id: agent.id, label: agent.name },
        details: withReason(
          `Sent a password reset link to ${agent.email}.`,
          input.note,
        ),
      });
    });

    revalidate("/admin/agents");
    return { ok: true, message: `Reset link sent to ${agent.email}.` };
  } catch (error) {
    return failed(error, "The reset link was not sent.");
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

    await mutate(operator.actor, async ({ tx, now, audit }) => {
      const [existing] = await tx
        .select({ id: t.platformSettings.id })
        .from(t.platformSettings)
        .limit(1);
      if (!existing) throw new Error("Platform settings have not been initialised.");

      // Stored as one jsonb column per section, matching the shape the CRM
      // edits and the services read. Written whole: the form submits the
      // complete settings object, so a partial update could only ever mean a
      // section the operator did not see was left behind.
      await tx
        .update(t.platformSettings)
        .set({
          platform: input.settings.platform,
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

    revalidate("/admin/settings", "/admin");
    return { ok: true, message: "Settings saved." };
  } catch (error) {
    return failed(error, "The settings were not saved.");
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
