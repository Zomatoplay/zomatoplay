import { notFound } from "next/navigation";

import { UserDetailView } from "@/components/admin/users/user-detail-view";
import { getAdminUsers } from "@/server/services/admin.service";

/**
 * A single user's profile.
 *
 * The route validates the id against the directory and prerenders one page per
 * user; the view then reads the live record from the admin store, so changes
 * made during a session are reflected without a reload.
 */

export async function generateStaticParams() {
  const users = await getAdminUsers();
  return users.map((user) => ({ id: user.id }));
}

async function findUser(id: string) {
  const users = await getAdminUsers();
  return users.find((user) => user.id === id);
}

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
