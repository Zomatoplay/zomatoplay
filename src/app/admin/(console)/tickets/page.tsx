import { redirect } from "next/navigation";

import { TicketsView } from "@/components/admin/tickets/tickets-view";
import { AdminAuthorizationError, requirePermission } from "@/server/admin/session";
import { getAdminTickets } from "@/server/services/admin.service";
import type { TicketStatus } from "@/types";

export const metadata = { title: "Support tickets" };

const STATUSES: TicketStatus[] = ["open", "awaiting_reply", "resolved"];

/**
 * The support queue. The read itself is permission-checked here, on the server —
 * the page's access notice in the browser is a courtesy, not the boundary.
 */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  try {
    await requirePermission("users", "view");
  } catch (error) {
    if (error instanceof AdminAuthorizationError) redirect("/admin");
    throw error;
  }
  const { status } = await searchParams;
  const active = STATUSES.find((value) => value === status);
  const { tickets, counts } = await getAdminTickets(active);
  return <TicketsView tickets={tickets} counts={counts} active={active ?? "all"} />;
}
