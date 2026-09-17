import { Suspense } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminListSkeleton } from "@/components/admin/shared/admin-skeleton";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { InvestmentsBrowser } from "@/components/admin/money/investments-view";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import {
  parseAdminListQuery,
  type RawSearchParams,
} from "@/lib/admin-list-query";
import {
  getAdminInvestmentsPage,
  getAdminPlans,
} from "@/server/services/admin.service";

export const metadata = { title: "Investments" };

/**
 * Every allocation on the platform, one page at a time.
 *
 * The plan catalogue is read alongside the page because the plan filter needs
 * to offer every plan — including one with no allocations, which is exactly
 * the case an operator opens this screen to confirm. It is a small, bounded
 * table and is cached across requests by tag (CLAUDE.md §16.9).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseAdminListQuery(
    await searchParams,
    ADMIN_LIST_SPECS.investments,
  );

  return (
    <>
      <AdminHeader
        title="Investments"
        description="Every allocation across all plans and users."
      />
      <AdminPage>
        <PermissionGate permission="investments">
          <Suspense
            key={`${query.page}|${query.search}|${query.status}|${query.filter}|${query.sort}`}
            fallback={<AdminListSkeleton label="Loading investments" />}
          >
            <InvestmentsList query={query} />
          </Suspense>
        </PermissionGate>
      </AdminPage>
    </>
  );
}

async function InvestmentsList({
  query,
}: {
  query: ReturnType<typeof parseAdminListQuery>;
}) {
  const [page, plans] = await Promise.all([
    getAdminInvestmentsPage(query),
    getAdminPlans(),
  ]);
  return <InvestmentsBrowser page={page} query={query} plans={plans} />;
}
