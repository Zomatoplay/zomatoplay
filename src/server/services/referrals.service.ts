import "server-only";

import { unstable_noStore as noStore } from "next/cache";

import { getDb, isDatabaseConfigured, type Database } from "@/db";
import type { CommissionEntry, Referral, ReferralSummary } from "@/types";

import { resolveUserId } from "../current-user";
import {
  findReferralSummary,
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
  const id = await resolveUserId(userId);
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
