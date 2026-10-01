import "server-only";

import { eq } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";

import {
  WITHDRAWAL_PASSWORD_LOCK_MINUTES,
  WITHDRAWAL_PASSWORD_MAX_ATTEMPTS,
} from "@/lib/withdrawal-password-rules";

import { hashPassword, verifyPassword } from "../auth/password-hash";
import { resilientRead } from "../database";
import { mutate, withReason, type Actor } from "../write";

/**
 * The withdrawal password: a second secret, separate from sign-in, required to
 * request a withdrawal.
 *
 * Created once, after a fresh SMS code to the account's verified number
 * (`createWithdrawalPasswordAction`). Never changed by the customer after
 * that: a forgotten password is cleared by an operator holding
 * `security: manage` (`resetWithdrawalPassword`, audited), and the customer
 * then creates a new one through the same SMS step. There is deliberately no
 * "OTP → new password" reset — whoever holds the phone could otherwise empty
 * the account.
 *
 * The plaintext exists only in the request that carries it: it is hashed with
 * scrypt (`password-hash.ts`), never stored, logged, recorded in a pipeline
 * event or returned.
 */

export class WithdrawalPasswordError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WithdrawalPasswordError";
  }
}

export {
  WITHDRAWAL_PASSWORD_LOCK_MINUTES,
  WITHDRAWAL_PASSWORD_MAX_ATTEMPTS,
  withdrawalPasswordRefusal,
} from "@/lib/withdrawal-password-rules";

export interface WithdrawalPasswordState {
  isSet: boolean;
  /** ISO time until which withdrawals are locked after wrong attempts. */
  lockedUntil: string | null;
}

export async function getWithdrawalPasswordState(userId: string): Promise<WithdrawalPasswordState> {
  if (!isDatabaseConfigured()) return { isSet: false, lockedUntil: null };
  const [row] = await resilientRead(() =>
    getDb()
      .select({ lockedUntil: t.withdrawalPasswords.lockedUntil })
      .from(t.withdrawalPasswords)
      .where(eq(t.withdrawalPasswords.userId, userId))
      .limit(1),
  );
  const locked = row?.lockedUntil && row.lockedUntil.getTime() > Date.now() ? row.lockedUntil : null;
  return { isSet: Boolean(row), lockedUntil: locked?.toISOString() ?? null };
}

/**
 * Stores a new withdrawal password for an account that has none. The caller
 * has already verified a fresh SMS code for the account's own number and
 * validated the password (`withdrawalPasswordRefusal`).
 */
export async function createWithdrawalPassword(
  request: { userId: string; password: string },
  actor: Actor,
): Promise<void> {
  // Hashed before the transaction opens, so ~50 ms of CPU never holds a lock.
  const passwordHash = await hashPassword(request.password);

  await mutate(actor, async ({ tx, now }) => {
    // Insert-if-absent, decided by the primary key rather than a prior read:
    // two tabs setting a password at once cannot both win.
    const inserted = await tx
      .insert(t.withdrawalPasswords)
      .values({ userId: request.userId, passwordHash, createdAt: now, updatedAt: now })
      .onConflictDoNothing({ target: t.withdrawalPasswords.userId })
      .returning({ userId: t.withdrawalPasswords.userId });
    if (inserted.length === 0) {
      throw new WithdrawalPasswordError(
        "A withdrawal password is already set. To change it, contact support.",
      );
    }
  });
}

/**
 * Checks a withdrawal password, counting failures. Throws on any refusal.
 *
 * Its own transaction, committed before the withdrawal is created: a wrong
 * attempt must be counted even though the withdrawal it belonged to is
 * refused, which would not happen if the count rolled back with it.
 */
export async function checkWithdrawalPassword(
  userId: string,
  password: unknown,
  actor: Actor,
): Promise<void> {
  if (typeof password !== "string" || password.length === 0 || password.length > 256) {
    throw new WithdrawalPasswordError("Enter your withdrawal password.");
  }

  const outcome = await mutate(actor, async ({ tx, now }) => {
    const [row] = await tx
      .select()
      .from(t.withdrawalPasswords)
      .where(eq(t.withdrawalPasswords.userId, userId))
      .limit(1)
      .for("update");
    if (!row) return { kind: "missing" as const };
    if (row.lockedUntil && row.lockedUntil.getTime() > now.getTime()) {
      return { kind: "locked" as const, until: row.lockedUntil };
    }

    if (await verifyPassword(password, row.passwordHash)) {
      if (row.failedAttempts > 0 || row.lockedUntil) {
        await tx
          .update(t.withdrawalPasswords)
          .set({ failedAttempts: 0, lockedUntil: null, updatedAt: now })
          .where(eq(t.withdrawalPasswords.userId, userId));
      }
      return { kind: "ok" as const };
    }

    const failures = row.failedAttempts + 1;
    const lock = failures >= WITHDRAWAL_PASSWORD_MAX_ATTEMPTS;
    const until = lock ? new Date(now.getTime() + WITHDRAWAL_PASSWORD_LOCK_MINUTES * 60_000) : null;
    await tx
      .update(t.withdrawalPasswords)
      .set({ failedAttempts: lock ? 0 : failures, lockedUntil: until, updatedAt: now })
      .where(eq(t.withdrawalPasswords.userId, userId));
    return lock
      ? { kind: "locked" as const, until: until as Date }
      : { kind: "wrong" as const, remaining: WITHDRAWAL_PASSWORD_MAX_ATTEMPTS - failures };
  });

  switch (outcome.kind) {
    case "ok":
      return;
    case "missing":
      throw new WithdrawalPasswordError(
        "Create a withdrawal password in Settings → Security before withdrawing.",
      );
    case "locked": {
      const minutes = Math.max(1, Math.ceil((outcome.until.getTime() - Date.now()) / 60_000));
      throw new WithdrawalPasswordError(
        `Too many incorrect withdrawal passwords. Withdrawals are locked for ${minutes} more minute${minutes === 1 ? "" : "s"}.`,
      );
    }
    case "wrong":
      throw new WithdrawalPasswordError(
        `Incorrect withdrawal password. ${outcome.remaining} attempt${outcome.remaining === 1 ? "" : "s"} left before withdrawals are locked for ${WITHDRAWAL_PASSWORD_LOCK_MINUTES} minutes.`,
      );
  }
}

/**
 * Clears a customer's withdrawal password so they can create a new one.
 * Operator-only (`security: manage`, checked by the action), reason required,
 * audited in the same transaction. Their next withdrawal needs a new password,
 * which needs a fresh SMS code to their verified number.
 */
export async function resetWithdrawalPassword(
  request: { userId: string; reason: string },
  actor: Actor,
): Promise<void> {
  if (actor.kind !== "agent") {
    throw new WithdrawalPasswordError("Only an operator can reset a withdrawal password.");
  }
  await mutate(actor, async ({ tx, audit }) => {
    const [user] = await tx
      .select({ id: t.users.id, fullName: t.users.fullName, displayId: t.users.displayId })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1);
    if (!user) throw new WithdrawalPasswordError("That customer does not exist.");

    const removed = await tx
      .delete(t.withdrawalPasswords)
      .where(eq(t.withdrawalPasswords.userId, user.id))
      .returning({ userId: t.withdrawalPasswords.userId });
    if (removed.length === 0) {
      throw new WithdrawalPasswordError("This customer has no withdrawal password to reset.");
    }

    audit({
      action: "withdrawal_password_reset",
      target: { type: "user", id: user.id, label: `${user.fullName} (${user.displayId})` },
      details: withReason(
        "Cleared the withdrawal password. The customer must create a new one, by SMS verification, before withdrawing.",
        request.reason,
      ),
    });
  });
}
