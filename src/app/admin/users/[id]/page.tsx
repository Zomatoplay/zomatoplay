import { notFound } from "next/navigation";

import { UserDetailView } from "@/components/admin/users/user-detail-view";
import { adminUsers, getAdminUserById } from "@/data/admin/users";

/**
 * A single user's profile.
 *
 * The route validates the id against the seed directory and prerenders one page
 * per user; the view then reads the live record from the admin store, so
 * changes made during a session are reflected without a reload.
 */

export function generateStaticParams() {
  return adminUsers.map((user) => ({ id: user.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = getAdminUserById(id);
  return { title: user ? `${user.fullName} · Users` : "User" };
}

export default async function AdminUserDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!getAdminUserById(id)) notFound();

  return <UserDetailView userId={id} />;
}
