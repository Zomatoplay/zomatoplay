"use server";

import { eq } from "drizzle-orm";

import * as t from "@/db/schema";
import { isGender, isValidEmail, missingProfileFields } from "@/lib/profile";
import { getAuthenticatedAccount, getUsableAccount } from "@/server/auth/account";
import { toSafeFailure } from "@/server/errors";
import { describeError } from "@/server/observability";
import { takeToken } from "@/server/rate-limit";
import { revalidate } from "@/server/revalidate";
import {
  createAvatarUploadTarget,
  isOwnAvatarKey,
  verifyAvatarObject,
} from "@/server/storage/avatar-store";
import { mutate, type Actor } from "@/server/write";

/**
 * First-time profile onboarding: full name, gender and email (required) and
 * an optional profile photo in private S3.
 *
 * The account being updated comes from the session, not from the form — a
 * `userId` field here would let anyone rewrite somebody else's profile.
 * Existing valid values are kept: a field the form leaves blank never erases
 * what is stored, and the verified mobile number is never touched.
 */
export async function saveProfile(input: {
  fullName?: string;
  gender?: string;
  email?: string;
  /** A key from `requestAvatarUploadAction`, after the browser's PUT. */
  avatarKey?: string | null;
  /** Legacy email accounts only: a display phone when none is on file. */
  phone?: string;
}): Promise<{ ok: boolean; message: string }> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };

  const fullName = (input.fullName ?? "").trim() || account.fullName.trim();
  const gender = (input.gender ?? "").trim() || account.gender || "";
  const email = ((input.email ?? "").trim() || account.email).toLowerCase();

  if (fullName.length < 2 || fullName.length > 120) {
    return { ok: false, message: "Enter your full name." };
  }
  if (!isGender(gender)) return { ok: false, message: "Choose your gender." };
  if (!isValidEmail(email)) return { ok: false, message: "Enter a valid email address." };
  if (missingProfileFields({ fullName, gender, email }).length > 0) {
    return { ok: false, message: "Complete every required field." };
  }

  // A legacy email account without a verified number still needs a display
  // number, exactly as before; a phone account never sends one.
  const verified = account.phoneE164 !== null;
  const phone = verified ? null : (input.phone ?? "").trim();
  if (phone !== null && phone !== "" && phone.replace(/\D/g, "").length < 8) {
    return { ok: false, message: "Enter a valid phone number." };
  }

  let avatarKey: string | null = null;
  if (input.avatarKey) {
    if (!isOwnAvatarKey(input.avatarKey, account.userId)) {
      return { ok: false, message: "That photo upload is not valid. Try again." };
    }
    try {
      await verifyAvatarObject(input.avatarKey);
    } catch (error) {
      return { ok: false, message: toSafeFailure(error, "The photo could not be saved.").message };
    }
    avatarKey = input.avatarKey;
  }

  const actor: Actor = { kind: "user", id: account.userId, name: fullName, role: "agent" };

  try {
    await mutate(actor, async ({ tx, now, audit }) => {
      await tx
        .update(t.users)
        .set({
          fullName,
          gender,
          email,
          ...(avatarKey ? { avatarStorageKey: avatarKey } : {}),
          ...(phone ? { phone } : {}),
          profileCompletedAt: now,
          updatedAt: now,
        })
        .where(eq(t.users.id, account.userId));

      audit({
        action: "user_updated",
        target: { type: "user", id: account.userId, label: account.displayId },
        details: `Completed first-time profile (name, gender, email${avatarKey ? ", photo" : ""}).`,
      });
    });
  } catch (error) {
    if (/users_email_key/.test(describeError(error))) {
      return { ok: false, message: "That email address is already registered to another account." };
    }
    return { ok: false, message: toSafeFailure(error, "Your profile could not be saved. Try again.").message };
  }

  return { ok: true, message: "Profile saved." };
}

/**
 * A 5-minute upload slot for the account's own profile photo. Rate-limited,
 * and refused when S3 is not configured — the photo is optional, so the form
 * simply continues without one.
 */
export async function requestAvatarUploadAction(input: {
  contentType: string;
  byteSize: number;
}): Promise<
  | { ok: true; key: string; url: string; headers: Record<string, string> }
  | { ok: false; message: string }
> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!takeToken(`avatar-upload:${account.userId}`, 10, 15 * 60 * 1000).allowed) {
    return { ok: false, message: "Too many uploads. Please wait a few minutes." };
  }
  try {
    const target = await createAvatarUploadTarget({
      userId: account.userId,
      contentType: String(input?.contentType ?? ""),
      byteSize: Number(input?.byteSize),
    });
    return { ok: true, ...target };
  } catch (error) {
    return { ok: false, message: toSafeFailure(error, "Photo upload is not available right now.").message };
  }
}

/**
 * Adds or replaces the profile photo after onboarding (Settings → Edit
 * profile). Same rules as onboarding: the key must be one this account was
 * issued, and S3 must hold a valid photo there before the row points at it.
 * The previous object is left in place — it is unreferenced, private, and
 * deleting it would need a permission the instance role does not otherwise
 * require.
 */
export async function saveAvatarAction(input: {
  avatarKey: string;
}): Promise<{ ok: boolean; message: string }> {
  const account = await getUsableAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };
  if (!isOwnAvatarKey(input?.avatarKey, account.userId)) {
    return { ok: false, message: "That photo upload is not valid. Try again." };
  }
  try {
    await verifyAvatarObject(input.avatarKey);
    const actor: Actor = { kind: "user", id: account.userId, name: account.fullName, role: "agent" };
    await mutate(actor, async ({ tx, now, audit }) => {
      await tx
        .update(t.users)
        .set({ avatarStorageKey: input.avatarKey, updatedAt: now })
        .where(eq(t.users.id, account.userId));
      audit({
        action: "user_updated",
        target: { type: "user", id: account.userId, label: account.displayId },
        details: account.avatarStorageKey ? "Replaced profile photo." : "Added profile photo.",
      });
    });
  } catch (error) {
    return { ok: false, message: toSafeFailure(error, "The photo could not be saved. Try again.").message };
  }
  revalidate("/settings", "/settings/profile", "/");
  return { ok: true, message: "Profile photo updated." };
}
