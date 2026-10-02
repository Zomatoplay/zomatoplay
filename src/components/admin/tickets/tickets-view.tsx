import Link from "next/link";
import { MessageSquare } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { TICKET_CATEGORIES, TICKET_STATUS_BADGES } from "@/lib/ticket-rules";
import { cn } from "@/lib/utils";
import type { TicketStatus } from "@/types";
import type { AdminTicket } from "@/types/admin";
import { formatDateTime } from "@/utils/format";

const FILTERS: { id: TicketStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "open", label: "Needs reply" },
  { id: "awaiting_reply", label: "Awaiting customer" },
  { id: "resolved", label: "Resolved" },
];

/**
 * The support queue: customers' tickets, most recently active first. The chips
 * are links — the status is in the URL, like every other console list — and
 * their counts ignore the active filter so a filtered view never understates
 * the rest.
 */
export function TicketsView({
  tickets,
  counts,
  active,
}: {
  tickets: AdminTicket[];
  counts: Record<TicketStatus, number>;
  active: TicketStatus | "all";
}) {
  const total = counts.open + counts.awaiting_reply + counts.resolved;
  return (
    <>
      <AdminHeader
        title="Support tickets"
        description="Conversations opened by customers. Reply here and the customer sees it in their Help centre."
      />
      <AdminPage>
        <nav aria-label="Filter tickets" className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((filter) => {
            const count = filter.id === "all" ? total : counts[filter.id];
            const selected = filter.id === active;
            return (
              <Link
                key={filter.id}
                href={filter.id === "all" ? "/admin/tickets" : `/admin/tickets?status=${filter.id}`}
                aria-current={selected ? "page" : undefined}
                className={cn(
                  "inline-flex min-h-9 items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors",
                  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
                  selected
                    ? "border-brand/30 bg-brand-soft text-brand"
                    : "border-border bg-card text-muted-foreground hover:text-foreground",
                )}
              >
                {filter.label}
                <span className="tabular text-xs">{count}</span>
              </Link>
            );
          })}
        </nav>

        {tickets.length === 0 ? (
          <EmptyState
            icon={MessageSquare}
            title={active === "all" ? "No tickets yet" : "Nothing in this view"}
            description={
              active === "all"
                ? "When a customer opens a ticket from their Help centre it will appear here."
                : "No tickets have this status right now."
            }
          />
        ) : (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {tickets.map((ticket) => {
              const status = TICKET_STATUS_BADGES[ticket.status];
              const category = TICKET_CATEGORIES.find((item) => item.id === ticket.category)?.label;
              return (
                <li key={ticket.id}>
                  <Link
                    href={`/admin/tickets/${ticket.id}`}
                    className="flex flex-col gap-1.5 px-4 py-3.5 transition-colors hover:bg-secondary/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                  >
                    <div className="min-w-0">
                      <p className="break-words text-sm font-medium text-foreground">{ticket.subject}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {ticket.customer.name} ({ticket.customer.displayId}) · {ticket.id}
                        {category ? ` · ${category}` : ""} · {ticket.messages}{" "}
                        {ticket.messages === 1 ? "message" : "messages"}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <Badge variant={status.variant}>{status.label}</Badge>
                      <span className="tabular text-xs text-muted-foreground">
                        {formatDateTime(ticket.updatedAt)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </AdminPage>
    </>
  );
}
