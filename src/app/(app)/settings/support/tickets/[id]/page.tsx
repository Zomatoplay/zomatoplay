import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { PageContainer } from "@/components/navigation/app-shell";
import { TicketReplyForm } from "@/components/settings/ticket-forms";
import { PageHeader } from "@/components/shared/page-header";
import { TicketThread } from "@/components/shared/ticket-thread";
import { Badge } from "@/components/ui/badge";
import { TICKET_CATEGORIES, TICKET_STATUS_BADGES } from "@/lib/ticket-rules";
import { getTicketDetail } from "@/server/services/account.service";
import { formatDate } from "@/utils/format";

export const metadata: Metadata = { title: "Support ticket" };

/**
 * One of the signed-in customer's own tickets. `getTicketDetail` filters on the
 * session's account, so another customer's id is simply "not found".
 */
export default async function TicketPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getTicketDetail(id);
  if (!detail) notFound();

  const { ticket, messages } = detail;
  const status = TICKET_STATUS_BADGES[ticket.status];
  const category = TICKET_CATEGORIES.find((item) => item.id === ticket.category)?.label;

  return (
    <>
      <PageHeader title="Support ticket" backHref="/settings/support#tickets" />
      <PageContainer>
        <div className="space-y-5">
          <header className="space-y-2">
            <h1 className="break-words text-lg font-semibold tracking-tight">{ticket.subject}</h1>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={status.variant}>{status.label}</Badge>
              <span className="tabular text-xs text-muted-foreground">
                {ticket.id}
                {category ? ` · ${category}` : ""} · Opened {formatDate(ticket.createdAt)}
              </span>
            </div>
          </header>
          <TicketThread messages={messages} viewer="customer" />
          <TicketReplyForm ticketId={ticket.id} resolved={ticket.status === "resolved"} />
        </div>
      </PageContainer>
    </>
  );
}
