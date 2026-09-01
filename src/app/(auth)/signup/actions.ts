"use server";

import { cookies } from "next/headers";

import { isRedeemableReferralCode } from "@/server/services/referrals.service";

/**
 * Redeeming an invite **code**, as opposed to following an invite **link**.
 *
 * WHY THIS WAS MISSING AND WHY IT MATTERS
 * ---------------------------------------
 * The referral screen shows two things side by side: a link, and a short
 * "Invite code" with its own copy affordance. The link worked — the middleware
 * captures `?ref=` on any route into a cookie that survives the signup and the
 * email confirmation that follows it. The code did not work anywhere. It was
 * rendered prominently, invited being read aloud or pasted into a chat, and
 * then had no field in the entire application that would accept it.
 *
 * This is the other half. It writes the **same cookie** the middleware writes,
 * with the same name and lifetime, so everything downstream is unchanged:
 * `ensureAccountForCurrentPrincipal` still resolves it once, at account
 * creation, against a real user, and still refuses a code that names nobody or
 * names the person signing up.
 *
 * A TYPED CODE OVERRIDES A STORED ONE, AND THAT IS DELIBERATE
 * -----------------------------------------------------------
 * The middleware is first-wins: a second link cannot overwrite an attribution
 * an earlier link already earned. That rule exists to stop one *link* stealing
 * from another, and it should not extend to a person typing a code themselves.
 * Somebody entering a code in the signup form at the moment they sign up is
 * making an explicit choice about their own account, and silently ignoring it
 * in favour of a link they clicked three weeks ago would be the wrong answer.
 *
 * NOTHING HERE GRANTS ANYTHING
 * ----------------------------
 * The shape is validated so the cookie cannot carry arbitrary text, and that is
 * the whole of the checking done here. Whether the code names a real referrer
 * is decided server-side at account creation, in a transaction, with the
 * self-referral check — the only moment it can be applied and the only moment
 * it is trusted.
 */

/** The name and lifetime are the middleware's; changing one means changing both. */
const REFERRAL_COOKIE = "nanotron-ref";
const THIRTY_DAYS = 60 * 60 * 24 * 30;

/** The same shape the middleware accepts. */
const CODE_PATTERN = /^[A-Za-z0-9]{4,32}$/;

export interface ReferralCodeResult {
  ok: boolean;
  message: string;
}

export async function applyReferralCode(input: {
  code: string;
}): Promise<ReferralCodeResult> {
  const code = input.code.trim().toUpperCase();

  /*
   * AN EMPTY FIELD CLEARS THE ATTRIBUTION — IT DOES NOT LEAVE IT ALONE.
   *
   * The brief's rule is that manual entry beats the URL, and clearing the box
   * is manual entry. Somebody who follows `/signup?ref=ABC123`, decides they do
   * not want to be attributed to that person and empties the field would
   * otherwise still be attributed: the middleware has already written the
   * cookie from the query string, and doing nothing here leaves it standing.
   * So an empty field deletes it.
   */
  if (code.length === 0) {
    try {
      (await cookies()).delete(REFERRAL_COOKIE);
    } catch {
      // No writable cookie scope. Nothing to clear, nothing to report.
    }
    return { ok: true, message: "No invite code." };
  }

  if (!CODE_PATTERN.test(code)) {
    return {
      ok: false,
      message: "An invite code is 4–32 letters and numbers.",
    };
  }

  /*
   * CHECKED AGAINST A REAL ACCOUNT, SERVER-SIDE.
   *
   * Shape alone was not enough. A mistyped-but-well-formed code passed every
   * check, was stored, and was then silently dropped at account creation by
   * `resolveReferrer` — so the person believed they had used their friend's
   * code, the friend never appeared as a referrer, and nothing anywhere said
   * why. Refusing here is the only moment somebody can still fix it.
   *
   * A referral code is a token people are told to share — the referral screen
   * prints it with a copy button — so confirming one is valid discloses nothing
   * that was not already public. Deliberately no owner name in the response:
   * "valid" is the whole answer.
   */
  let redeemable: boolean;
  try {
    redeemable = await isRedeemableReferralCode(code);
  } catch {
    /*
     * The database is unreachable. Let it through rather than blocking a
     * registration over a check that is a courtesy: `resolveReferrer` will
     * re-resolve the code inside the account-creation transaction, and an
     * invalid one costs the signup nothing there.
     */
    redeemable = true;
  }

  if (!redeemable) {
    return {
      ok: false,
      message: "That invite code does not match an account. Check it, or leave it blank.",
    };
  }

  try {
    (await cookies()).set(REFERRAL_COOKIE, code, {
      path: "/",
      maxAge: THIRTY_DAYS,
      httpOnly: true,
      sameSite: "lax",
    });
  } catch {
    // No writable cookie scope. The signup still proceeds unattributed rather
    // than failing — a broken referral is not the new user's problem.
    return { ok: false, message: "The invite code could not be saved." };
  }

  return { ok: true, message: "Invite code applied." };
}
