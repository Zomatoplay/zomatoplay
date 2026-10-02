import { notFound, redirect } from "next/navigation";

import { TicketDetailView } from "@/components/admin/tickets/ticket-detail-view";
import { AdminAuthorizationError, requirePermission } from "@/server/admin/session";
import { getAdminTicket } from "@/server/services/admin.service";

export const metadata = { title: "Support ticket" };

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  try {
    await requirePermission("users", "view");
  } catch (error) {
    if (error instanceof AdminAuthorizationError) redirect("/admin");
    throw error;
  }
  const { id } = await params;
  const found = await getAdminTicket(id);
  if (!found) notFound();
  return <TicketDetailView ticket={found.ticket} messages={found.messages} />;
}
