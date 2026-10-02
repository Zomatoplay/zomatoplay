"use client";

import Link from "next/link";
import { ChevronRight, Mail, MessageSquare, Plus } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { EmptyState } from "@/components/shared/empty-state";
import { TelegramSupportButton } from "@/components/shared/telegram-support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { faqs, helpTopics } from "@/data/support";
import { TICKET_STATUS_BADGES } from "@/lib/ticket-rules";
import { formatDate } from "@/utils/format";
import type { SupportTicket } from "@/types";

export function SupportCenter({
  tickets,
  telegramUrl,
  supportEmail,
}: {
  /** The account's own conversations. FAQs and help topics stay static copy. */
  tickets: SupportTicket[];
  /** The operator-configured Telegram destination; null when none is set. */
  telegramUrl: string | null;
  /** The operator-configured support mailbox; null when none is set. */
  supportEmail: string | null;
}) {
  return (
    <div className="space-y-6">
      {/* Help topics */}
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Browse help topics
        </h2>
        <div className="grid grid-cols-2 gap-3">
          {helpTopics.map((topic) => (
            <div
              key={topic.id}
              className="min-w-0 rounded-2xl border border-border bg-card p-4"
            >
              <p className="truncate text-sm font-semibold text-foreground">
                {topic.title}
              </p>
              <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                {topic.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Frequently asked questions
        </h2>
        <div className="rounded-2xl border border-border bg-card px-4">
          <Accordion type="single" collapsible>
            {faqs.map((faq, index) => (
              <AccordionItem key={faq.question} value={`faq-${index}`}>
                <AccordionTrigger>{faq.question}</AccordionTrigger>
                <AccordionContent>{faq.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </section>

      {/* Tickets. Always rendered: Settings links here with #tickets. */}
      <section id="tickets" className="space-y-2 scroll-mt-20">
        <div className="flex items-center justify-between gap-3 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Your support tickets
          </h2>
          <Button asChild variant="outline" size="sm">
            <Link href="/settings/support/new">
              <Plus className="size-4" aria-hidden />
              New ticket
            </Link>
          </Button>
        </div>
        {tickets.length > 0 ? (
          <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
            {tickets.map((ticket) => {
              const status = TICKET_STATUS_BADGES[ticket.status];
              return (
                <li key={ticket.id}>
                  <Link
                    href={`/settings/support/tickets/${ticket.id}`}
                    className="flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-secondary/60 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
                  >
                    <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                      <MessageSquare className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-sm font-medium text-foreground">
                        {ticket.subject}
                      </p>
                      <p className="tabular mt-0.5 text-xs text-muted-foreground">
                        {ticket.id} · {ticket.messages} {ticket.messages === 1 ? "message" : "messages"}
                      </p>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant={status.variant}>{status.label}</Badge>
                        <span className="tabular text-[11px] text-muted-foreground">
                          Updated {formatDate(ticket.updatedAt)}
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="mt-2 size-4 shrink-0 text-muted-foreground" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState
            icon={MessageSquare}
            title="No support tickets yet"
            description="Open a ticket and our team will reply here. You can also reach us on Telegram or by email below."
          />
        )}
      </section>

      {/*
        Contact. These are the channels that reach a person: the Telegram
        account an operator configured, and the support mailbox. There used to
        be an in-app form here that said "Message sent" and stored nothing — a
        customer waiting on a reply to a message nobody received is worse off
        than one who is shown where to write.
      */}
      <section className="space-y-3">
        <div className="space-y-1 px-1">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Contact us
          </h2>
          <p className="text-sm leading-relaxed text-muted-foreground">
            Open a ticket above, message us on Telegram, or email us. Tell us your member ID and what
            happened — for a deposit or withdrawal, include the amount, the date and its reference.
            Never share your one-time code or withdrawal password; we will never ask for them.
          </p>
        </div>
        {telegramUrl ? <TelegramSupportButton url={telegramUrl} /> : null}
        {supportEmail ? (
          <Button asChild variant={telegramUrl ? "outline" : "brand"} size="lg" block>
            <a href={`mailto:${supportEmail}`}>
              <Mail className="size-4" aria-hidden />
              Email {supportEmail}
            </a>
          </Button>
        ) : null}
        {!telegramUrl && !supportEmail ? (
          <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-center text-xs leading-relaxed text-muted-foreground">
            Support contact details are being set up. Please check back shortly.
          </p>
        ) : null}
      </section>
    </div>
  );
}
