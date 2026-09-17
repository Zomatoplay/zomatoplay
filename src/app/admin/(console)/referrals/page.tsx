import { Suspense } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminListSkeleton } from "@/components/admin/shared/admin-skeleton";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { ReferralsBrowser } from "@/components/admin/referrals/referrals-view";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import {
  parseAdminListQuery,
  type RawSearchParams,
} from "@/lib/admin-list-query";
import {
  getAdminCommissionLedgerPage,
  getAdminReferralAccountsPage,
  getAdminReferralsSummary,
} from "@/server/services/admin.service";

export const metadata = { title: "Referrals" };

/**
 * Referral accounts and the commission ledger.
 *
 * The only console screen carrying two independent lists, so it parses two
 * queries from one URL — the account table under the `a` prefix and the
 * ledger under `c`. Paging one leaves the other exactly where it was.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const accountQuery = parseAdminListQuery(
    params,
    ADMIN_LIST_SPECS.referralAccounts,
    "a",
  );
  const commissionQuery = parseAdminListQuery(
    params,
    ADMIN_LIST_SPECS.commissions,
    "c",
  );

  const key = (prefix: string, q: ReturnType<typeof parseAdminListQuery>) =>
    `${prefix}:${q.page}|${q.search}|${q.status}|${q.sort}`;

  return (
    <>
      <AdminHeader
        title="Referrals"
        description="Referral accounts, VIP standing and the commission ledger."
      />
      <AdminPage>
        <PermissionGate permission="referrals">
          <Suspense
            key={`${key("a", accountQuery)}|${key("c", commissionQuery)}`}
            fallback={<AdminListSkeleton label="Loading referrals" />}
          >
            <ReferralsLists
              accountQuery={accountQuery}
              commissionQuery={commissionQuery}
            />
          </Suspense>
        </PermissionGate>
      </AdminPage>
    </>
  );
}

async function ReferralsLists({
  accountQuery,
  commissionQuery,
}: {
  accountQuery: ReturnType<typeof parseAdminListQuery>;
  commissionQuery: ReturnType<typeof parseAdminListQuery>;
}) {
  // One wave. Three independent reads against a five-connection pool is one
  // round trip of wall time, not three (CLAUDE.md §16.1a).
  const [accounts, commissions, summary] = await Promise.all([
    getAdminReferralAccountsPage(accountQuery),
    getAdminCommissionLedgerPage(commissionQuery),
    getAdminReferralsSummary(),
  ]);

  return (
    <ReferralsBrowser
      accounts={accounts}
      commissions={commissions}
      accountQuery={accountQuery}
      commissionQuery={commissionQuery}
      summary={summary}
    />
  );
}
