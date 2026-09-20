import "server-only";

import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured, type Database } from "@/db";
import type { CommissionEntry, Referral, ReferralSummary } from "@/types";

import { resolveUserId, resolveUserIdForPage } from "../current-user";
import {
  findReferralSummary,
  findReferrerByCode,
  listCommissionsForUser,
  listReferralsForUser,
} from "../repositories/referrals.repository";

import { AccountUnavailableError } from "./account.service";
import { getVipLevels } from "./catalogue.service";

/**
 * The referral programme, from the referrer's side.
 *
 * Commission percentages and thresholds are never restated here — the summary
 * is computed against the VIP levels the catalogue service returns, so both
 * applications quote the same numbers (CLAUDE.md §10).
 *
 * Like the account service, these have no seed-data fallback: a referral
 * standing belongs to one person.
 */

/** Reads live account state, with no fallback. See `account.service`. */
async function read<T>(query: (db: Database) => Promise<T>): Promise<T> {
  if (!isDatabaseConfigured()) {
    throw new AccountUnavailableError();
  }
  noStore();
  return query(getDb());
}

export async function getReferralSummary(
  userId?: string,
): Promise<ReferralSummary> {
  const id = await resolveUserIdForPage(userId);
  const vipLevels = await getVipLevels();

  return read(async (db) => {
    const summary = await findReferralSummary(db, id, vipLevels);
    // An account with no referral row has not referred anyone — an empty
    // standing, not the demo account's standing.
    return (
      summary ?? {
        totalReferrals: 0,
        activeReferrals: 0,
        totalEarnings: 0,
        pendingEarnings: 0,
        teamVolume: 0,
        currentLevel: "vip1" as const,
        nextLevelProgress: 0,
      }
    );
  });
}

/**
 * These two keep the throwing resolver deliberately.
 *
 * `/referral` awaits both inside a `SectionBoundary`, whose error boundary
 * catches whatever the read throws and renders a section notice — and it does
 * not re-throw Next's redirect signal. Resolving the identity by redirecting
 * here would therefore be *swallowed* rather than honoured.
 *
 * An unauthenticated visitor still leaves for sign-in: the layout's gate
 * redirects on an absent session before any of this renders, and every other
 * boundary on the page resolves through `requireCurrentUserIdForPage`. These
 * panels simply fail inside their own boundary on the way out.
 */
export async function getReferrals(userId?: string): Promise<Referral[]> {
  const id = await resolveUserId(userId);
  return read((db) => listReferralsForUser(db, id));
}

export async function getCommissionHistory(
  userId?: string,
): Promise<CommissionEntry[]> {
  const id = await resolveUserId(userId);
  return read((db) => listCommissionsForUser(db, id));
}

/**
 * Whether an invite code can actually be redeemed.
 *
 * Used by the signup form so a mistyped code is refused while the person is
 * still looking at the field, rather than silently dropped at account creation
 * — which is what happened before, and which produced an unattributed account
 * and a referrer who never found out why.
 *
 * **This is a courtesy check, not the decision.** The attribution that counts is
 * made inside the account-creation transaction by `resolveReferrer`, which
 * re-resolves the code against a real row and applies the self-referral rule
 * there. This one can be stale by the time signup completes — minutes later,
 * after an email confirmation — and that is fine: it exists to give feedback,
 * not to grant anything.
 *
 * No fallback and no `AccountUnavailableError`: a database outage here should
 * not block a registration. The caller treats "unknown" as "let it through" and
 * lets creation-time resolution be the judge.
 */
export async function isRedeemableReferralCode(code: string): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  noStore();
  return (await findReferrerByCode(getDb(), code)) !== null;
}
