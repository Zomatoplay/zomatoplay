import { Suspense } from "react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { AdminListSkeleton } from "@/components/admin/shared/admin-skeleton";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { UsersBrowser } from "@/components/admin/users/users-view";
import { ADMIN_LIST_SPECS } from "@/constants/admin";
import {
  parseAdminListQuery,
  type RawSearchParams,
} from "@/lib/admin-list-query";
import { getAdminUsersPage } from "@/server/services/admin.service";

export const metadata = { title: "Users" };

/**
 * The user directory.
 *
 * WHY THE HEADER IS OUTSIDE THE SUSPENSE BOUNDARY
 * -----------------------------------------------
 * This page used to `await` its data before returning any markup, so a slow
 * pooler rendered as a blank screen and `loading.tsx` was the only thing
 * standing between an operator and nothing at all. The title, the description
 * and the permission gate depend on no query — they are known the moment the
 * request arrives — so they are emitted first and the data region streams in
 * behind them. The reader sees the page they clicked immediately and the rows
 * arrive when Postgres has them.
 *
 * The boundary is keyed on the query, so changing a filter shows the skeleton
 * for the *new* query rather than silently holding the previous rows. That is
 * only the fallback of last resort: an in-page filter change goes through
 * `useTransition` in the controls, which keeps the current rows visible and
 * dims them instead (see `admin-list-controls.tsx`).
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const query = parseAdminListQuery(await searchParams, ADMIN_LIST_SPECS.users);

  return (
    <>
      <AdminHeader
        title="Users"
        description="Search, filter and administer every account on the platform."
      />
      <AdminPage>
        <PermissionGate permission="users">
          <Suspense
            key={`${query.page}|${query.search}|${query.status}|${query.filter}|${query.sort}`}
            fallback={<AdminListSkeleton label="Loading users" />}
          >
            <UsersList query={query} />
          </Suspense>
        </PermissionGate>
      </AdminPage>
    </>
  );
}

/** The part that waits for Postgres. */
async function UsersList({
  query,
}: {
  query: ReturnType<typeof parseAdminListQuery>;
}) {
  const page = await getAdminUsersPage(query);
  return <UsersBrowser page={page} query={query} />;
}
