"use server";

import { getAuthenticatedAccount } from "@/server/auth/account";
import { toSafeFailure } from "@/server/errors";
import { traceAction } from "@/server/trace-action";
import { recordSecurityEvent } from "@/server/auth/sign-in-record";
import { revalidate } from "@/server/revalidate";
import {
  addBankAccount,
  addWalletAddress,
  setNotificationPreference,
  setSecondFactorPreference,
  updateUserProfile,
} from "@/server/services/account-write.service";
import type { NotificationCategory } from "@/types";
import type { Actor } from "@/server/write";

/**
 * Everything the settings screens change about an account.
 *
 * All of these used to be reducer cases or `setTimeout` fakes: a toast that
 * said "Profile updated — demo build, changes are not persisted", a switch that
 * moved a boolean in browser memory, a "not part of this build" notice on the
 * only control that could give an account somewhere to be paid. They write to
 * PostgreSQL now, through the same audited unit of work as everything else.
 *
 * The account is always the session's. None of these takes a user id.
 */

export interface SettingsResult {
  ok: boolean;
  message: string;
}

/**
 * Turns a thrown value into something the account holder may be shown.
 *
 * `toSafeFailure` speaks only for this application's own named error classes
 * (`AccountValidationError` and its siblings) — "that account number is too
 * short" reaches the browser, a Postgres connection fault does not. It used
 * to return `error.message` for any `Error` at all, which meant a transient
 * database failure (a full connection pool, a dropped connection) was shown
 * to the customer as raw driver text instead of "try again in a moment".
 */
function failure(error: unknown, fallback: string): SettingsResult {
  return { ok: false, message: toSafeFailure(error, fallback).message };
}

async function actorForSession(): Promise<
  { actor: Actor; userId: string } | null
> {
  const account = await getAuthenticatedAccount();
  if (!account) return null;
  return {
    userId: account.userId,
    actor: {
      kind: "user",
      id: account.userId,
      name: account.fullName || account.email,
      role: "agent",
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Profile                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Name and phone only — and not the phone once it has been verified by OTP:
 * that number is the account's sign-in, and a form edit is not evidence of
 * owning a different one. The server ignores it rather than trusting the
 * form to hide the field.
 *
 * The email address is **not** editable here, and that is a decision rather
 * than an omission. Supabase Auth owns the email: it is the sign-in identifier
 * and the thing a verification link proved control of. Letting this form write
 * `users.email` would leave the two disagreeing — the person would sign in with
 * one address and see another — and would let an account be re-pointed at a
 * mailbox nobody has verified. Changing it has to go through Supabase's own
 * re-verification, which is a separate flow that is not built.
 */
export async function updateProfileAction(input: {
  fullName: string;
  phone: string;
}): Promise<SettingsResult> {
  return traceAction(
    { name: "updateProfile", actorType: "user", pipeline: "auth" },
    async () => {
      const session = await actorForSession();
      if (!session) return { ok: false, message: "Not signed in." };

      const fullName = input.fullName.trim();
      const phone = input.phone.trim();
      const account = await getAuthenticatedAccount();
      const phoneLocked = Boolean(account?.phoneE164);

      if (fullName.length < 2) return { ok: false, message: "Enter your full name." };
      if (!phoneLocked && phone.replace(/\D/g, "").length < 8) {
        return { ok: false, message: "Enter a valid phone number." };
      }

      try {
        await updateUserProfile(
          {
            userId: session.userId,
            changes: phoneLocked ? { fullName } : { fullName, phone },
          },
          session.actor,
        );
        revalidate("/settings", "/settings/profile", "/");
        return { ok: true, message: "Profile updated." };
      } catch (error) {
        return failure(error, "The profile was not updated.");
      }
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Security                                                                    */
/* -------------------------------------------------------------------------- */

export async function setSecondFactorAction(input: {
  factor: "twoFactor" | "googleAuth";
  enabled: boolean;
}): Promise<SettingsResult> {
  return traceAction(
    { name: "setSecondFactor", actorType: "user", pipeline: "auth" },
    async () => {
      const session = await actorForSession();
      if (!session) return { ok: false, message: "Not signed in." };

      try {
        await setSecondFactorPreference(
          { userId: session.userId, factor: input.factor, enabled: input.enabled },
          session.actor,
        );
        await recordSecurityEvent({
          userId: session.userId,
          type: "two_factor_changed",
          description: `${
            input.factor === "twoFactor" ? "Two-factor authentication" : "Authenticator app"
          } ${input.enabled ? "enabled" : "disabled"}`,
        });
        revalidate("/settings/security", "/settings");
        return { ok: true, message: "Preference saved." };
      } catch (error) {
        return failure(error, "The preference was not saved.");
      }
    },
  );
}

/**
 * Records that a password change happened. It does not perform one.
 *
 * The change itself is `supabase.auth.updateUser({ password })`, called from
 * the browser against Supabase — the password never passes through this
 * application. What is left here is the security-feed entry, so the CRM and the
 * user's own activity list show the event.
 */
export async function recordPasswordChangeAction(): Promise<SettingsResult> {
  return traceAction(
    { name: "recordPasswordChange", actorType: "user", pipeline: "auth" },
    async () => {
      const session = await actorForSession();
      if (!session) return { ok: false, message: "Not signed in." };

      await recordSecurityEvent({
        userId: session.userId,
        type: "password_changed",
        description: "Password changed",
      });
      revalidate("/settings/security");
      return { ok: true, message: "Password change recorded." };
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Notifications                                                               */
/* -------------------------------------------------------------------------- */

export async function setNotificationPreferenceAction(input: {
  category: NotificationCategory;
  enabled: boolean;
}): Promise<SettingsResult> {
  return traceAction(
    { name: "setNotificationPreference", actorType: "user", pipeline: "admin" },
    async () => {
      const session = await actorForSession();
      if (!session) return { ok: false, message: "Not signed in." };

      try {
        await setNotificationPreference(
          { userId: session.userId, category: input.category, enabled: input.enabled },
          session.actor,
        );
        revalidate("/settings/notifications", "/settings");
        return { ok: true, message: "Preference saved." };
      } catch (error) {
        return failure(error, "The preference was not saved.");
      }
    },
  );
}

/* -------------------------------------------------------------------------- */
/* Payout and deposit destinations                                             */
/* -------------------------------------------------------------------------- */

export async function addBankAccountAction(input: {
  label: string;
  bankName: string;
  accountNumber: string;
  ifsc: string;
  holderName: string;
}): Promise<SettingsResult> {
  return traceAction(
    { name: "addBankAccount", actorType: "user", pipeline: "withdrawal" },
    async () => {
      const session = await actorForSession();
      if (!session) return { ok: false, message: "Not signed in." };

      if (!input.bankName.trim()) return { ok: false, message: "Enter the bank name." };
      if (!input.holderName.trim()) {
        return { ok: false, message: "Enter the account holder's name." };
      }
      if (!/^[A-Za-z]{4}0[A-Za-z0-9]{6}$/.test(input.ifsc.trim().toUpperCase())) {
        return { ok: false, message: "That IFSC code is not valid." };
      }

      try {
        await addBankAccount({ userId: session.userId, ...input }, session.actor);
        revalidate("/settings/wallet", "/wallet/withdraw");
        return { ok: true, message: "Payout destination added." };
      } catch (error) {
        return failure(error, "The destination was not added.");
      }
    },
  );
}

export async function addWalletAddressAction(input: {
  label: string;
  network: "trc20" | "erc20" | "bep20" | "polygon";
  address: string;
}): Promise<SettingsResult> {
  return traceAction(
    { name: "addWalletAddress", actorType: "user", pipeline: "deposit" },
    async () => {
      const session = await actorForSession();
      if (!session) return { ok: false, message: "Not signed in." };

      try {
        await addWalletAddress({ userId: session.userId, ...input }, session.actor);
        revalidate("/settings/wallet");
        return { ok: true, message: "Address saved." };
      } catch (error) {
        return failure(error, "The address was not saved.");
      }
    },
  );
}
