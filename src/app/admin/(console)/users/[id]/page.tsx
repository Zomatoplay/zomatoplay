import { cache } from "react";
import { notFound } from "next/navigation";

import { UserDetailView } from "@/components/admin/users/user-detail-view";
import { getAdminUsers } from "@/server/services/admin.service";

/**
 * A single user's profile.
 *
 * NO `generateStaticParams`, AND IT MUST NOT COME BACK
 * ----------------------------------------------------
 * This route used to prerender one page per account. That did two things, and
 * both were wrong:
 *
 * 1. It ran `getAdminUsers()` — `users LEFT JOIN wallet_balances` — during
 *    `next build`, so the build could not complete unless it could reach
 *    production PostgreSQL. On Vercel that failed with `CONNECT_TIMEOUT`
 *    while collecting page data, and no amount of retrying would have helped:
 *    a build has no business depending on a live financial database.
 *
 * 2. It baked real names, member ids and wallet balances into static HTML —
 *    one file per user, sitting in the deployment bundle — for a route that
 *    exists behind operator authentication. Prerendering an authenticated
 *    screen writes its contents somewhere the authentication does not reach.
 *
 * The page is rendered on demand instead, which is what the console's layout
 * (`force-dynamic`) already required of every other screen. Authorization is
 * unchanged: the operator session is resolved and checked in that layout before
 * this renders.
 */

/**
 * Memoised per request.
 *
 * `generateMetadata` and the page body both need the record, and without this
 * each one issues its own full directory scan — the same query that was timing
 * out. `cache()` is request-scoped, so two calls in one render share a result
 * and a later request still reads fresh.
 */
const findUser = cache(async (id: string) => {
  const users = await getAdminUsers();
  return users.find((user) => user.id === id);
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await findUser(id);
  return { title: user ? `${user.fullName} · Users` : "User" };
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!(await findUser(id))) notFound();

  return <UserDetailView userId={id} />;
}
