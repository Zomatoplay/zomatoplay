import "server-only";

import { unstable_cache } from "next/cache";

import { getDb, isDatabaseConfigured, type Database } from "@/db";
import { plans as seedPlans } from "@/data/plans";
import { vipLevels as seedVipLevels } from "@/data/referrals";
import { depositNetworks as seedDepositNetworks } from "@/data/transactions";
import type { DepositNetwork, Plan, VipLevel } from "@/types";

import { resilientRead } from "../database";
import { SUPPORT_EMAIL } from "@/constants/app";
import { resolvePlatformFinance, type PlatformFinance } from "@/lib/platform-finance";
import { setFxRates } from "@/lib/currency";
import { parseSupportEmail, telegramSupportUrl } from "@/lib/support";

import {
  findFinanceSettings,
  findSupportEmail,
  findSupportTelegram,
  listDepositNetworks,
  listPublicPlans,
  listVipLevels,
} from "../repositories/catalogue.repository";

/**
 * Catalogue content for the user application.
 *
 * This is the static-feeling half of the app — plans, networks, VIP tiers — and
 * it stays server-rendered (CLAUDE.md §4.1). Reading it through a service
 * rather than importing `@/data` directly is what lets an operator's plan edit
 * reach the app once the CRM writes to the database.
 *
 * CACHED ACROSS REQUESTS, WHICH ACCOUNT DATA IS NOT
 * -------------------------------------------------
 * These three reads are the only ones in the application that may be shared
 * between users, and the distinction is the whole reason it is safe: a plan
 * list belongs to nobody. It is identical for every visitor, contains no
 * balance, no identity and no verification state, and the CRM is the only thing
 * that changes it.
 *
 * Account reads are deliberately *not* here and must never be added. They go
 * through `account.service`, which is memoised per request and re-read on the
 * next one — a cross-request cache there would mean serving one person's wallet
 * to another, which is the single worst failure this codebase can produce.
 *
 * INVALIDATION IS EXPLICIT, NOT JUST A TIMER
 * ------------------------------------------
 * Every entry is tagged `catalogue`, and the CRM's plan mutations drop that tag
 * (see `@/server/revalidate`), so an operator's edit is visible on the next
 * request rather than up to five minutes later. The TTL is only a backstop for
 * a change that reached the database by some other route — a migration, a
 * manual fix — and never the primary mechanism.
 */

/** The tag every catalogue entry carries. Dropped by `revalidateCatalogue()`. */
export const CATALOGUE_TAG = "catalogue";

/** Backstop only; the tag above is what makes an edit appear immediately. */
const CATALOGUE_TTL_SECONDS = 300;

/**
 * Wraps a catalogue read in a cross-request cache.
 *
 * The `isDatabaseConfigured()` check stays *outside* the cache, so a machine
 * with no `DATABASE_URL` returns the seed module directly and never caches it —
 * which keeps the no-database path exactly as it was, including staying
 * prerenderable at build time.
 *
 * `fromDatabase()` is deliberately not reused here: it calls `noStore()`, which
 * would opt this render out of caching and defeat the entire point. The two
 * guarantees it provides that matter are kept explicitly — the fallback is
 * still chosen by configuration rather than by failure, and the query still
 * runs through `resilientRead` for its deadline and bounded retry.
 */
async function cachedCatalogueRead<T>(
  key: string,
  query: (db: Database) => Promise<T>,
  fallback: () => T,
): Promise<T> {
  if (!isDatabaseConfigured()) return fallback();

  const read = () => resilientRead(() => query(getDb()));

  try {
    return await unstable_cache(read, [`catalogue:${key}`], {
      tags: [CATALOGUE_TAG],
      revalidate: CATALOGUE_TTL_SECONDS,
    })();
  } catch (error) {
    /*
     * `unstable_cache` needs Next's incremental cache, which only exists inside
     * a Next request. These services are also called from plain Node — the
     * seed and migration scripts, the TRON scanner, the test suite — where it
     * throws an invariant before the query is ever attempted.
     *
     * Caching is an optimisation, so its absence must degrade to an uncached
     * read rather than to a failure. Narrowly matched on that one invariant:
     * anything else, including every real database error, propagates
     * untouched, because a catalogue that silently succeeds while the database
     * is down is the "no silent fallback" rule (§16.3) broken by the back door.
     */
    if (!isMissingNextCacheContext(error)) throw error;
    return read();
  }
}

/** Next's invariant for "called outside a request scope", and only that. */
function isMissingNextCacheContext(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("incrementalCache missing");
}

export async function getPlans(): Promise<Plan[]> {
  return cachedCatalogueRead("plans", listPublicPlans, () => seedPlans);
}

export async function getPlanBySlug(slug: string): Promise<Plan | undefined> {
  const plans = await getPlans();
  return plans.find((plan) => plan.slug === slug);
}

export async function getDepositNetworks(): Promise<DepositNetwork[]> {
  return cachedCatalogueRead(
    "deposit-networks",
    listDepositNetworks,
    () => seedDepositNetworks,
  );
}

export async function getVipLevels(): Promise<VipLevel[]> {
  return cachedCatalogueRead("vip-levels", listVipLevels, () => seedVipLevels);
}

/**
 * Where customers contact support on Telegram, or null when nobody has
 * configured it.
 *
 * Cached with the catalogue for the same reason the catalogue is: it is one
 * public contact handle, identical for every visitor and belonging to nobody.
 * Saving it in the CRM drops the tag, so the change is visible on the next
 * request. Re-validated on the way out, so a value that reached the column by
 * some other route than the admin action still cannot become a foreign link.
 */
export async function getSupportTelegramUrl(): Promise<string | null> {
  const username = await cachedCatalogueRead(
    "support-telegram",
    findSupportTelegram,
    () => null,
  );
  return telegramSupportUrl(username);
}

/**
 * The support mailbox customers see: the one an operator saved in Admin →
 * Settings → Platform, else the deployment's `NEXT_PUBLIC_SUPPORT_EMAIL`, else
 * null (screens then say contact details are being set up). Re-validated on the
 * way out, like the Telegram handle, so a malformed stored value is ignored
 * rather than rendered into a `mailto:` link.
 */
export async function getSupportEmail(): Promise<string | null> {
  const stored = await cachedCatalogueRead("support-email", findSupportEmail, () => null);
  return parseSupportEmail(stored) ?? SUPPORT_EMAIL;
}

/**
 * The administrator's money settings — rates and withdrawal fee — for display.
 * Cached across requests with the catalogue (identical for everyone, owned by
 * no one) and cleared by `revalidateCatalogue()` when an operator saves.
 * Quotes that decide what is owed use `getPlatformFinanceFresh` instead.
 */
export async function getPlatformFinance(): Promise<PlatformFinance> {
  const stored = await cachedCatalogueRead("platform-finance", findFinanceSettings, () => null);
  return resolvePlatformFinance(stored);
}

/**
 * The same settings read straight from the database, uncached. A withdrawal is
 * priced from this, so the figure stored on the request is the figure in force
 * at that instant, not one from up to five minutes ago.
 */
export async function getPlatformFinanceFresh(): Promise<PlatformFinance> {
  if (!isDatabaseConfigured()) return resolvePlatformFinance(null);
  const stored = await resilientRead(() => findFinanceSettings(getDb()));
  return resolvePlatformFinance(stored);
}

/**
 * Makes the configured rates the ones every INR figure rendered on the server
 * uses (`@/lib/currency`). Awaited by the layouts before their children render;
 * a failure leaves the initial rates in place rather than breaking the page.
 */
export async function applyPlatformRates(): Promise<PlatformFinance> {
  const finance = await getPlatformFinance();
  setFxRates({
    depositRate: finance.depositRate,
    withdrawalRate: finance.withdrawalRate,
    label: finance.rateLabel,
  });
  return finance;
}
