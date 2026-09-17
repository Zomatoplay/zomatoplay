import { Suspense } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminListSkeleton } from "@/components/admin/shared/admin-skeleton";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { KycQueue } from "@/components/admin/kyc/kyc-view";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import {
  parseAdminListQuery,
  type RawSearchParams,
} from "@/lib/admin-list-query";
import { getKycSubmissionsPage } from "@/server/services/admin.service";

export const metadata = { title: "KYC" };

/**
 * The verification review queue.
 *
 * A page of cases now also means a page of *documents*: the read attaches
 * documents and notes only for the ids it returned, where it once read every
 * KYC document and note on the platform to render a screen.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseAdminListQuery(await searchParams, ADMIN_LIST_SPECS.kyc);

  return (
    <>
      <AdminHeader
        title="KYC"
        description="Review identity verification submissions and record decisions."
      />
      <AdminPage>
        <PermissionGate permission="kyc">
          <Suspense
            key={`${query.page}|${query.search}|${query.status}|${query.sort}`}
            fallback={<AdminListSkeleton label="Loading verification queue" />}
          >
            <KycList query={query} />
          </Suspense>
        </PermissionGate>
      </AdminPage>
    </>
  );
}

async function KycList({
  query,
}: {
  query: ReturnType<typeof parseAdminListQuery>;
}) {
  const page = await getKycSubmissionsPage(query);
  return <KycQueue page={page} query={query} />;
}
