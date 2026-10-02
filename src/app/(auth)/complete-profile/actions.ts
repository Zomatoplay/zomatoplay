"use server";

import { eq } from "drizzle-orm";

import * as t from "@/db/schema";
import { getAuthenticatedAccount } from "@/server/auth/account";
import { mutate, type Actor } from "@/server/write";

/**
 * Saves the profile a newly-created account still needs.
 *
 * The account being updated comes from the session, not from the form. A
 * `userId` field here would be an authorization hole: anyone could post
 * somebody else's id and rewrite their name.
 */
export async function saveProfile(input: {
  fullName: string;
  /** Ignored for an account with a verified number — see below. */
  phone?: string;
  country?: string;
}): Promise<{ ok: boolean; message: string }> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Your session has expired. Please sign in again." };

  const fullName = input.fullName.trim();
  // A verified number is never overwritten by a typed one: the profile form
  // does not even offer the field to a phone-signed-in account.
  const verified = account.phoneE164 !== null;
  const phone = verified ? null : (input.phone ?? "").trim();

  if (fullName.length < 2) {
    return { ok: false, message: "Enter your full name." };
  }
  if (phone !== null && phone.replace(/\D/g, "").length < 8) {
    return { ok: false, message: "Enter a valid phone number." };
  }

  const actor: Actor = {
    kind: "user",
    id: account.userId,
    name: fullName,
    role: "agent",
  };

  await mutate(actor, async ({ tx, now, audit }) => {
    await tx
      .update(t.users)
      .set({
        fullName,
        // Display only, and only for a legacy account without a verified
        // number. Nothing authenticates against it — `phone_e164` is the
        // verified one.
        ...(phone !== null ? { phone } : {}),
        country: input.country?.trim() || "India",
        updatedAt: now,
      })
      .where(eq(t.users.id, account.userId));

    audit({
      action: "user_updated",
      target: { type: "user", id: account.userId, label: account.email || account.displayId },
      details: "Completed profile after first sign-in.",
    });
  });

  return { ok: true, message: "Profile saved." };
}
