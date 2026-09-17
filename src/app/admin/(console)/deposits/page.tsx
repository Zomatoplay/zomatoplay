import { Suspense } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminListSkeleton } from "@/components/admin/shared/admin-skeleton";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { DepositsBrowser } from "@/components/admin/money/deposits-view";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import {
  parseAdminListQuery,
  type RawSearchParams,
} from "@/lib/admin-list-query";
import { getAdminDepositsPage } from "@/server/services/admin.service";

export const metadata = { title: "Deposits" };

/**
 * The deposit ledger and the attribution queue.
 *
 * Two reads left this page when it became server-paginated. It used to fetch
 * every deposit *and* every user — the second only so the attribution dialog
 * could search the directory in the browser. The dialog now asks the server
 * for at most eight matches when an operator types, so the directory never
 * has to be here at all.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseAdminListQuery(
    await searchParams,
    ADMIN_LIST_SPECS.deposits,
  );

  return (
    <>
      <AdminHeader
        title="Deposits"
        description="Incoming USDT transfers and their confirmation state."
      />
      <AdminPage>
        <PermissionGate permission="deposits">
          <Suspense
            key={`${query.page}|${query.search}|${query.status}|${query.sort}`}
            fallback={<AdminListSkeleton label="Loading deposits" />}
          >
            <DepositsList query={query} />
          </Suspense>
        </PermissionGate>
      </AdminPage>
    </>
  );
}

async function DepositsList({
  query,
}: {
  query: ReturnType<typeof parseAdminListQuery>;
}) {
  const page = await getAdminDepositsPage(query);
  return <DepositsBrowser page={page} query={query} />;
}
