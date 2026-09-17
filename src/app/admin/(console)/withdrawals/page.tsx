import { Suspense } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminListSkeleton } from "@/components/admin/shared/admin-skeleton";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { WithdrawalsBrowser } from "@/components/admin/money/withdrawals-view";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import {
  parseAdminListQuery,
  type RawSearchParams,
} from "@/lib/admin-list-query";
import { getAdminWithdrawalsPage } from "@/server/services/admin.service";

export const metadata = { title: "Withdrawals" };

/** The payout queue. One page of requests, plus the queue-wide figures. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseAdminListQuery(
    await searchParams,
    ADMIN_LIST_SPECS.withdrawals,
  );

  return (
    <>
      <AdminHeader
        title="Withdrawals"
        description="Review, approve and settle INR payout requests."
      />
      <AdminPage>
        <PermissionGate permission="withdrawals">
          <Suspense
            key={`${query.page}|${query.search}|${query.status}|${query.sort}`}
            fallback={<AdminListSkeleton label="Loading withdrawals" />}
          >
            <WithdrawalsList query={query} />
          </Suspense>
        </PermissionGate>
      </AdminPage>
    </>
  );
}

async function WithdrawalsList({
  query,
}: {
  query: ReturnType<typeof parseAdminListQuery>;
}) {
  const page = await getAdminWithdrawalsPage(query);
  return <WithdrawalsBrowser page={page} query={query} />;
}
