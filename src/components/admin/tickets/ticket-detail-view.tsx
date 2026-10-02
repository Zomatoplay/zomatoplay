"use client";

import { useState } from "react";
import Link from "next/link";
import { ChevronLeft, Send } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage } from "@/components/admin/layout/admin-shell";
import { DetailCard, DetailList, DetailRow } from "@/components/admin/shared/detail-list";
import { useAdminAction } from "@/components/admin/shared/use-admin-action";
import { TicketThread } from "@/components/shared/ticket-thread";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/input";
import { canManage } from "@/lib/admin-permissions";
import { useAdminStore } from "@/lib/admin-store";
import { TICKET_BODY_MAX, TICKET_CATEGORIES, messageRefusal, TICKET_STATUS_BADGES } from "@/lib/ticket-rules";
import type { TicketMessage, TicketStatus } from "@/types";
import type { AdminTicket } from "@/types/admin";
import { formatDateTime } from "@/utils/format";
import {
  replyToTicketAsSupportAction,
  setTicketStatusAction,
} from "@/app/admin/actions";

/** One ticket: the thread, a reply box, and the status controls. */
export function TicketDetailView({
  ticket,
  messages,
}: {
  ticket: AdminTicket;
  messages: TicketMessage[];
}) {
  const store = useAdminStore();
  const { run, pending } = useAdminAction();
  const allowed = canManage(store.session, "users");
  const [reply, setReply] = useState("");
  const [error, setError] = useState<string | null>(null);

  const status = TICKET_STATUS_BADGES[ticket.status];
  const category = TICKET_CATEGORIES.find((item) => item.id === ticket.category)?.label;

  function send(resolve: boolean) {
    const refusal = messageRefusal(reply);
    if (refusal) {
      setError(refusal);
      return;
    }
    setError(null);
    run(() => replyToTicketAsSupportAction({ ticketId: ticket.id, message: reply, resolve }), {
      onSuccess: () => setReply(""),
    });
  }

  function changeStatus(next: TicketStatus) {
    run(() => setTicketStatusAction({ ticketId: ticket.id, status: next }));
  }

  return (
    <>
      <AdminHeader title={ticket.subject} description={`${ticket.id} · ${category ?? "Ticket"}`} />
      <AdminPage>
        <Link
          href="/admin/tickets"
          className="mb-4 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <ChevronLeft className="size-4" aria-hidden />
          All tickets
        </Link>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <div className="min-w-0 space-y-5">
            <TicketThread messages={messages} viewer="support" />

            <form
              className="space-y-3 rounded-2xl border border-border bg-card p-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (allowed && !pending) send(false);
              }}
            >
              <Label htmlFor="support-reply">Reply to {ticket.customer.name}</Label>
              <Textarea
                id="support-reply"
                value={reply}
                maxLength={TICKET_BODY_MAX}
                rows={5}
                disabled={!allowed || pending}
                onChange={(event) => setReply(event.target.value)}
              />
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
              {!allowed ? (
                <p className="text-xs text-muted-foreground">
                  You have view-only access. A master admin can grant manage access to Users.
                </p>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button type="submit" variant="brand" disabled={!allowed || pending}>
                  <Send className="size-4" aria-hidden />
                  Send reply
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  disabled={!allowed || pending}
                  onClick={() => send(true)}
                >
                  Send &amp; resolve
                </Button>
              </div>
            </form>
          </div>

          <aside className="space-y-5">
            <DetailCard title="Ticket">
              <DetailList>
                <DetailRow label="Status">
                  <Badge variant={status.variant}>{status.label}</Badge>
                </DetailRow>
                <DetailRow label="Customer">
                    <Link
                      href={`/admin/users/${ticket.customer.id}`}
                      className="text-brand underline-offset-2 hover:underline"
                    >
                      {ticket.customer.name} ({ticket.customer.displayId})
                    </Link>
                  </DetailRow>
                <DetailRow label="Opened">{formatDateTime(ticket.createdAt)}</DetailRow>
                <DetailRow label="Last activity">{formatDateTime(ticket.updatedAt)}</DetailRow>
              </DetailList>
            </DetailCard>
            <DetailCard title="Change status">
              <div className="flex flex-wrap gap-2">
                {(["open", "awaiting_reply", "resolved"] as const).map((value) => (
                  <Button
                    key={value}
                    type="button"
                    size="sm"
                    variant={ticket.status === value ? "brand" : "outline"}
                    disabled={!allowed || pending || ticket.status === value}
                    onClick={() => changeStatus(value)}
                  >
                    {value === "open" ? "Needs reply" : value === "awaiting_reply" ? "Awaiting customer" : "Resolved"}
                  </Button>
                ))}
              </div>
            </DetailCard>
          </aside>
        </div>
      </AdminPage>
    </>
  );
}
