/**
 * The rules for attaching a verified phone number to a Nanotron account.
 *
 * Pure functions, deliberately: these decide whether somebody can reach an
 * account holding money, so they are tested exhaustively without a database
 * (`phone-identity.test.ts`) and the database code only carries them out.
 *
 *   Firebase user → firebase_uid → users.id → wallet
 *
 * THE THREE RULES
 * ---------------
 * 1. **A Firebase uid reaches exactly the account it was linked to.** Never
 *    assumed equal to a Nanotron id, never re-pointed automatically.
 * 2. **Nothing is ever linked by an unverified number.** `users.phone` is
 *    whatever somebody typed on the profile form; a typo there would otherwise
 *    hand one person's balance to the owner of the mistyped number. Only
 *    `users.phone_e164` — written from a verified token — is consulted.
 * 3. **A conflict is refused, never resolved.** A verified number already on
 *    another account, or a uid already on another account, stops the flow and
 *    sends the person to support. Merging two financial accounts is an operator
 *    decision with an audit trail, not a side effect of signing in.
 */

export interface UidMatch {
  id: string;
}

export interface PhoneMatch {
  id: string;
  firebaseUid: string | null;
}

export type PhoneSignInDecision =
  | { action: "use"; userId: string }
  | { action: "create" }
  | { action: "refuse"; reason: "phone_linked_to_other_account" };

/** Phone OTP sign-in by somebody not otherwise signed in. */
export function decidePhoneSignIn(input: {
  firebaseUid: string;
  byUid: UidMatch | null;
  byPhone: PhoneMatch | null;
}): PhoneSignInDecision {
  // Rule 1: the uid is the key.
  if (input.byUid) return { action: "use", userId: input.byUid.id };

  // A verified number already belongs to an account under a different (or no)
  // uid: the Firebase user was deleted and re-created, or an operator is mid-
  // repair. Either way, not something to settle silently (rule 3).
  if (input.byPhone && input.byPhone.firebaseUid !== input.firebaseUid) {
    return { action: "refuse", reason: "phone_linked_to_other_account" };
  }

  return { action: "create" };
}

export type PhoneLinkDecision =
  | { action: "already_linked" }
  | { action: "link" }
  | {
      action: "refuse";
      reason:
        | "account_has_other_number"
        | "uid_linked_to_other_account"
        | "phone_linked_to_other_account";
    };

/**
 * An existing (email) customer, signed in as themselves, verifying a phone.
 *
 * The account comes from their legacy session — proof they own it — and the
 * number from a fresh Firebase verification — proof they own that. Only when
 * neither is already attached elsewhere are the two joined.
 */
export function decidePhoneLink(input: {
  account: { id: string; firebaseUid: string | null };
  firebaseUid: string;
  byUid: UidMatch | null;
  byPhone: PhoneMatch | null;
}): PhoneLinkDecision {
  const { account, firebaseUid, byUid, byPhone } = input;

  if (account.firebaseUid === firebaseUid) return { action: "already_linked" };
  if (account.firebaseUid) {
    return { action: "refuse", reason: "account_has_other_number" };
  }
  if (byUid && byUid.id !== account.id) {
    return { action: "refuse", reason: "uid_linked_to_other_account" };
  }
  if (byPhone && byPhone.id !== account.id) {
    return { action: "refuse", reason: "phone_linked_to_other_account" };
  }
  return { action: "link" };
}

/** What a person is told. Safe to show: they have just proved they own the number. */
export const PHONE_REFUSAL_MESSAGES = {
  phone_linked_to_other_account:
    "This mobile number is already linked to a Nanotron account. Contact support to restore access.",
  uid_linked_to_other_account:
    "This mobile number is already linked to a different Nanotron account. Contact support.",
  account_has_other_number:
    "Your account is already linked to a different mobile number. Contact support to change it.",
} as const;
