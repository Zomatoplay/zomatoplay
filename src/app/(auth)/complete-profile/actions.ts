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
  phone: string;
  country?: string;
}): Promise<{ ok: boolean; message: string }> {
  const account = await getAuthenticatedAccount();
  if (!account) return { ok: false, message: "Not signed in." };

  const fullName = input.fullName.trim();
  const phone = input.phone.trim();

  if (fullName.length < 2) {
    return { ok: false, message: "Enter your full name." };
  }
  if (phone.replace(/\D/g, "").length < 8) {
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
        // Kept on the profile so phone authentication can be added later
        // without a migration. Nothing authenticates against it today.
        phone,
        country: input.country?.trim() || "India",
        updatedAt: now,
      })
      .where(eq(t.users.id, account.userId));

    audit({
      action: "user_updated",
      target: { type: "user", id: account.userId, label: account.email },
      details: "Completed profile after first sign-in.",
    });
  });

  return { ok: true, message: "Profile saved." };
}
