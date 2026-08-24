import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import type { KycStatus, NotificationCategory } from "@/types";
import type { AdminUserRestrictions, AdminUserStatus } from "@/types/admin";

import { applyLedgerEntry, ensureWallet } from "../repositories/wallet.repository";
import { mutate, newId, withReason, SYSTEM_ACTOR, type Actor } from "../write";

/**
 * Writes against an account: profile, status, verification, notifications,
 * referrals and commissions.
 *
 * Each one is a transaction with an audit entry, for the same reason the CRM's
 * store always wrote them together: an operations console whose audit log is
 * assembled separately from the actions it describes will eventually describe
 * something that did not happen.
 */

/* -------------------------------------------------------------------------- */
/* Users                                                                       */
/* -------------------------------------------------------------------------- */

export async function createUser(
  input: {
    fullName: string;
    email: string;
    phone: string;
    country?: string;
    displayId: string;
    referralCode: string;
    referredByCode?: string | null;
    walletAddress: string;
  },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ userId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const userId = newId("usr", now);

    await tx.insert(t.users).values({
      id: userId,
      displayId: input.displayId,
      fullName: input.fullName,
      email: input.email.toLowerCase(),
      phone: input.phone,
      country: input.country ?? "India",
      registeredAt: now,
      lastActiveAt: now,
      referralCode: input.referralCode,
      referredByCode: input.referredByCode ?? null,
      walletAddress: input.walletAddress,
      createdAt: now,
      updatedAt: now,
    });

    // A user without a wallet row cannot be credited, so it is created here
    // rather than lazily at the first deposit.
    await ensureWallet(tx, userId);

    audit({
      action: "user_updated",
      target: { type: "user", id: userId, label: `${input.fullName} · ${input.displayId}` },
      details: `Created account ${input.displayId}.`,
    });

    return { userId };
  });
}

export async function updateUserProfile(
  request: {
    userId: string;
    changes: Partial<{
      fullName: string;
      email: string;
      phone: string;
      country: string;
      internalNote: string | null;
    }>;
  },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const changed = Object.keys(request.changes);
    if (changed.length === 0) return;

    await tx
      .update(t.users)
      .set({ ...request.changes, updatedAt: now })
      .where(eq(t.users.id, request.userId));

    audit({
      action: "user_updated",
      target: { type: "user", id: request.userId, label: request.userId },
      details: `Updated ${changed.join(", ")}.`,
    });
  });
}

export async function setUserStatus(
  request: { userId: string; status: AdminUserStatus; reason?: string },
  actor: Actor,
): Promise<void> {
  const actions = {
    active: "user_unblocked",
    blocked: "user_blocked",
    suspended: "user_suspended",
    deactivated: "user_deactivated",
    inactive: "user_updated",
  } as const;

  return mutate(actor, async ({ tx, now, audit }) => {
    await tx
      .update(t.users)
      .set({ status: request.status, updatedAt: now })
      .where(eq(t.users.id, request.userId));

    audit({
      action: actions[request.status],
      target: { type: "user", id: request.userId, label: request.userId },
      details: withReason(`Status set to ${request.status}.`, request.reason),
    });
  });
}

export async function setUserRestriction(
  request: {
    userId: string;
    key: keyof AdminUserRestrictions;
    value: boolean;
    reason?: string;
  },
  actor: Actor,
): Promise<void> {
  const columns = {
    accountFrozen: t.users.accountFrozen,
    withdrawalsFrozen: t.users.withdrawalsFrozen,
    investmentsFrozen: t.users.investmentsFrozen,
  } as const;

  return mutate(actor, async ({ tx, now, audit }) => {
    await tx
      .update(t.users)
      .set({ [columns[request.key].name]: request.value, updatedAt: now })
      .where(eq(t.users.id, request.userId));

    audit({
      action: "user_restriction_changed",
      target: { type: "user", id: request.userId, label: request.userId },
      details: withReason(
        `${request.key} ${request.value ? "enabled" : "lifted"}.`,
        request.reason,
      ),
    });
  });
}

/**
 * Second-factor preferences.
 *
 * These are *preferences on the application record*, not enrolments. Nothing in
 * this codebase challenges for a second factor — Supabase Auth owns
 * authentication, and its MFA enrolment is a separate flow that has not been
 * built. The columns exist because the CRM and the settings screen both show
 * them, and until now the settings screen changed a value in browser memory
 * that nothing ever read back.
 *
 * Persisting them is an improvement on that and is deliberately not more than
 * it looks: turning the switch on does not make an account harder to sign into.
 * That is recorded here so nobody later reads the column as a security control.
 *
 * INTEGRATION POINT: Supabase MFA enrolment drives these, and the switch
 * becomes the entry point to it.
 */
export async function setSecondFactorPreference(
  request: {
    userId: string;
    factor: "twoFactor" | "googleAuth";
    enabled: boolean;
  },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    await tx
      .update(t.users)
      .set(
        request.factor === "twoFactor"
          ? { twoFactorEnabled: request.enabled, updatedAt: now }
          : { googleAuthEnabled: request.enabled, updatedAt: now },
      )
      .where(eq(t.users.id, request.userId));

    audit({
      action: "user_two_factor_reset",
      target: { type: "user", id: request.userId, label: request.userId },
      details: `${
        request.factor === "twoFactor"
          ? "Two-factor authentication"
          : "Authenticator app"
      } ${request.enabled ? "enabled" : "disabled"}.`,
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Payout and deposit destinations                                             */
/* -------------------------------------------------------------------------- */

/**
 * Registers an INR payout destination.
 *
 * ONLY THE MASKED ACCOUNT NUMBER IS STORED.
 *
 * The full number is masked here, on the server, before it reaches a column —
 * the browser sends what the person typed, and what is kept is
 * `••••••1234`. There is no payout rail, so a prototype has no use for a whole
 * account number and every reason not to accumulate one. When a rail exists it
 * will hold the full number under its own handling; the schema does not
 * pre-empt that decision.
 */
export async function addBankAccount(
  request: {
    userId: string;
    label: string;
    bankName: string;
    accountNumber: string;
    ifsc: string;
    holderName: string;
  },
  actor: Actor,
): Promise<{ bankAccountId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const digits = request.accountNumber.replace(/\D/g, "");
    if (digits.length < 6) {
      throw new Error("That account number is too short.");
    }
    const masked = `${"•".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;

    const existing = await tx
      .select({ id: t.bankAccounts.id })
      .from(t.bankAccounts)
      .where(eq(t.bankAccounts.userId, request.userId));

    const id = newId("bank", now);
    await tx.insert(t.bankAccounts).values({
      id,
      userId: request.userId,
      label: request.label.trim() || request.bankName.trim(),
      bankName: request.bankName.trim(),
      accountNumberMasked: masked,
      ifsc: request.ifsc.trim().toUpperCase(),
      holderName: request.holderName.trim(),
      // The first destination registered is the default, so a withdrawal has
      // somewhere to go without a second decision.
      isDefault: existing.length === 0,
      createdAt: now,
    });

    audit({
      action: "user_updated",
      target: { type: "user", id: request.userId, label: request.userId },
      details: `Registered a payout destination at ${request.bankName.trim()} (${masked}).`,
    });

    return { bankAccountId: id };
  });
}

/** Saves a labelled USDT address. Addresses are public data; stored in full. */
export async function addWalletAddress(
  request: {
    userId: string;
    label: string;
    network: (typeof t.depositNetworkEnum.enumValues)[number];
    address: string;
  },
  actor: Actor,
): Promise<{ walletAddressId: string }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const address = request.address.trim();
    if (address.length < 20) throw new Error("That does not look like an address.");

    const existing = await tx
      .select({ id: t.walletAddresses.id })
      .from(t.walletAddresses)
      .where(eq(t.walletAddresses.userId, request.userId));

    const id = newId("addr", now);
    await tx.insert(t.walletAddresses).values({
      id,
      userId: request.userId,
      label: request.label.trim() || "Saved address",
      network: request.network,
      address,
      isDefault: existing.length === 0,
      createdAt: now,
    });

    audit({
      action: "user_updated",
      target: { type: "user", id: request.userId, label: request.userId },
      details: `Saved a ${request.network.toUpperCase()} address.`,
    });

    return { walletAddressId: id };
  });
}

/* -------------------------------------------------------------------------- */
/* Device sessions                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Marks a recorded device session revoked.
 *
 * WHAT THIS DOES AND DOES NOT DO — READ BEFORE RELYING ON IT
 * ----------------------------------------------------------
 * It marks a *description* of a session as revoked. It does not invalidate a
 * Supabase refresh token, because doing that requires the service-role key,
 * which this application deliberately does not hold (CLAUDE.md §19.6). The
 * browser holding that session keeps working until its refresh token expires.
 *
 * The row is honest about this and so is the UI. Faking it the other way —
 * showing "signed out" while the session is live — is the failure mode worth
 * avoiding: an operator would believe an account had been secured when it had
 * not.
 *
 * INTEGRATION POINT: a server-side admin client (service-role, held by a
 * separate privileged service, never by this one) calls
 * `auth.admin.signOut(userId, scope)` here.
 */
export async function revokeDeviceSessions(
  request: { userId: string; sessionId?: string; reason?: string },
  actor: Actor,
): Promise<{ revoked: number }> {
  return mutate(actor, async ({ tx, now, audit }) => {
    const scope = request.sessionId
      ? and(
          eq(t.userDeviceSessions.userId, request.userId),
          eq(t.userDeviceSessions.id, request.sessionId),
        )
      : eq(t.userDeviceSessions.userId, request.userId);

    const revoked = await tx
      .update(t.userDeviceSessions)
      .set({ status: "revoked", isCurrent: false, lastActiveAt: now })
      .where(and(scope, eq(t.userDeviceSessions.status, "active")))
      .returning({ id: t.userDeviceSessions.id });

    if (revoked.length > 0) {
      await tx.insert(t.userSecurityEvents).values({
        id: newId("sec", now),
        userId: request.userId,
        type: "device_logged_out",
        description: request.sessionId
          ? "A device session was revoked"
          : "All device sessions were revoked",
        device: "—",
        ipAddress: actor.ipAddress ?? "0.0.0.0",
        location: "Unknown",
        createdAt: now,
        outcome: "success",
      });
    }

    audit({
      action: request.sessionId ? "device_logged_out" : "all_devices_logged_out",
      target: { type: "user", id: request.userId, label: request.userId },
      details: withReason(
        `Marked ${revoked.length} device session${revoked.length === 1 ? "" : "s"} revoked. ` +
          "The credential itself is not invalidated — see revokeDeviceSessions.",
        request.reason,
      ),
    });

    return { revoked: revoked.length };
  });
}

/* -------------------------------------------------------------------------- */
/* Verification                                                                */
/* -------------------------------------------------------------------------- */

/**
 * Moves an account's verification status.
 *
 * Deliberately narrow: it sets the account's status and, where there is one,
 * the submission's. It does not talk to a provider, because there is not one —
 * see CLAUDE.md §2.
 */
export async function setKycStatus(
  request: {
    userId: string;
    status: KycStatus;
    submissionId?: string;
    reviewStatus?: "approved" | "rejected" | "resubmission_requested" | "under_review";
    reason?: string;
  },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    await tx
      .update(t.users)
      .set({ kycStatus: request.status, updatedAt: now })
      .where(eq(t.users.id, request.userId));

    if (request.submissionId && request.reviewStatus) {
      await tx
        .update(t.kycSubmissions)
        .set({
          status: request.reviewStatus,
          reviewedBy: actor.name,
          reviewedAt: now,
          rejectionReason:
            request.reviewStatus === "approved" ? null : (request.reason ?? null),
        })
        .where(eq(t.kycSubmissions.id, request.submissionId));
    }

    audit({
      action:
        request.reviewStatus === "approved"
          ? "kyc_approved"
          : request.reviewStatus === "rejected"
            ? "kyc_rejected"
            : request.reviewStatus === "resubmission_requested"
              ? "kyc_resubmission_requested"
              : "user_updated",
      target: { type: "kyc", id: request.submissionId ?? request.userId, label: request.userId },
      details: withReason(`Verification status set to ${request.status}.`, request.reason),
    });
  });
}

export async function addKycNote(
  request: { submissionId: string; body: string },
  actor: Actor,
): Promise<void> {
  return mutate(actor, async ({ tx, now, audit }) => {
    await tx.insert(t.kycNotes).values({
      id: newId("kyn", now),
      submissionId: request.submissionId,
      author: actor.name,
      body: request.body,
      createdAt: now,
    });

    audit({
      action: "kyc_note_added",
      target: { type: "kyc", id: request.submissionId, label: request.submissionId },
      details: "Added an internal note.",
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

/** Writes an in-app notification. No delivery exists; this is the record of it. */
export async function createNotification(
  request: {
    userId: string;
    category: NotificationCategory;
    title: string;
    body: string;
  },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ notificationId: string }> {
  return mutate(actor, async ({ tx, now }) => {
    const id = newId("ntf", now);
    await tx.insert(t.notifications).values({
      id,
      userId: request.userId,
      category: request.category,
      title: request.title,
      body: request.body,
      createdAt: now,
      read: false,
    });
    return { notificationId: id };
  });
}

export async function setNotificationPreference(
  request: { userId: string; category: NotificationCategory; enabled: boolean },
  actor: Actor = SYSTEM_ACTOR,
): Promise<void> {
  return mutate(actor, async ({ tx, now }) => {
    await tx
      .insert(t.userNotificationPreferences)
      .values({
        userId: request.userId,
        category: request.category,
        enabled: request.enabled,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: [
          t.userNotificationPreferences.userId,
          t.userNotificationPreferences.category,
        ],
        set: { enabled: request.enabled, updatedAt: now },
      });
  });
}

export async function markNotificationsRead(
  request: { userId: string },
  actor: Actor = SYSTEM_ACTOR,
): Promise<number> {
  return mutate(actor, async ({ tx }) => {
    const updated = await tx
      .update(t.notifications)
      .set({ read: true })
      .where(and(eq(t.notifications.userId, request.userId), eq(t.notifications.read, false)))
      .returning({ id: t.notifications.id });
    return updated.length;
  });
}

/* -------------------------------------------------------------------------- */
/* Referrals and commissions                                                   */
/* -------------------------------------------------------------------------- */

/** Records an introduction, and keeps the referrer's counters in step. */
export async function recordReferral(
  request: {
    referrerUserId: string;
    referredUserId?: string | null;
    name: string;
    maskedEmail: string;
    tier: 1 | 2;
  },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ referralId: string }> {
  return mutate(actor, async ({ tx, now }) => {
    const id = newId("ref", now);

    await tx.insert(t.referrals).values({
      id,
      referrerUserId: request.referrerUserId,
      referredUserId: request.referredUserId ?? null,
      name: request.name,
      maskedEmail: request.maskedEmail,
      joinedAt: now,
      status: "registered",
      tier: request.tier,
    });

    await tx
      .update(t.users)
      .set({
        referralCount: sql`${t.users.referralCount} + 1`,
        updatedAt: now,
      })
      .where(eq(t.users.id, request.referrerUserId));

    await tx
      .insert(t.referralAccounts)
      .values({
        userId: request.referrerUserId,
        directReferrals: request.tier === 1 ? 1 : 0,
        indirectReferrals: request.tier === 2 ? 1 : 0,
        joinedAt: now,
      })
      .onConflictDoUpdate({
        target: t.referralAccounts.userId,
        set: {
          directReferrals:
            request.tier === 1
              ? sql`${t.referralAccounts.directReferrals} + 1`
              : t.referralAccounts.directReferrals,
          indirectReferrals:
            request.tier === 2
              ? sql`${t.referralAccounts.indirectReferrals} + 1`
              : t.referralAccounts.indirectReferrals,
          updatedAt: now,
        },
      });

    return { referralId: id };
  });
}

/**
 * Credits a referral commission.
 *
 * The ledger entry and the aggregate move together. `credited` commissions
 * touch the wallet; `pending` ones only record the obligation, which is what
 * the configured payout delay is for.
 */
export async function creditCommission(
  request: {
    beneficiaryUserId: string;
    sourceUserId?: string | null;
    sourceUserName: string;
    tier: 1 | 2;
    amount: Decimal;
    sourcePlanName: string;
    status?: "credited" | "pending";
  },
  actor: Actor = SYSTEM_ACTOR,
): Promise<{ commissionId: string; ledgerTxId: string | null }> {
  const status = request.status ?? "credited";

  return mutate(actor, async ({ tx, now, audit }) => {
    const commissionId = newId("com", now);

    await tx.insert(t.commissionEntries).values({
      id: commissionId,
      beneficiaryUserId: request.beneficiaryUserId,
      sourceUserId: request.sourceUserId ?? null,
      sourceUserName: request.sourceUserName,
      tier: request.tier,
      amountUsdt: numericValue(request.amount),
      sourcePlanName: request.sourcePlanName,
      createdAt: now,
      status,
    });

    let ledgerTxId: string | null = null;

    if (status === "credited") {
      await ensureWallet(tx, request.beneficiaryUserId);
      ledgerTxId = await applyLedgerEntry(tx, {
        userId: request.beneficiaryUserId,
        type: "referral",
        amount: request.amount,
        description: `Referral commission · ${request.sourceUserName}`,
        reference: commissionId,
        occurredAt: now,
        buckets: { totalProfit: request.amount },
      });
    }

    await tx
      .insert(t.referralAccounts)
      .values({
        userId: request.beneficiaryUserId,
        commissionEarnedUsdt:
          status === "credited" ? numericValue(request.amount) : undefined,
        commissionPendingUsdt:
          status === "pending" ? numericValue(request.amount) : undefined,
        joinedAt: now,
      })
      .onConflictDoUpdate({
        target: t.referralAccounts.userId,
        set:
          status === "credited"
            ? {
                commissionEarnedUsdt: sql`${t.referralAccounts.commissionEarnedUsdt} + ${request.amount}::numeric`,
                updatedAt: now,
              }
            : {
                commissionPendingUsdt: sql`${t.referralAccounts.commissionPendingUsdt} + ${request.amount}::numeric`,
                updatedAt: now,
              },
      });

    audit({
      action: "user_updated",
      target: {
        type: "user",
        id: request.beneficiaryUserId,
        label: request.beneficiaryUserId,
      },
      details: `Tier ${request.tier} commission of ${request.amount} USDT (${status}).`,
    });

    return { commissionId, ledgerTxId };
  });
}
