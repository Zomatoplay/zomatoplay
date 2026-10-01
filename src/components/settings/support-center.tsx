"use client";

import { Mail, MessageSquare } from "lucide-react";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TelegramSupportButton } from "@/components/shared/telegram-support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/constants/app";
import { faqs, helpTopics } from "@/data/support";
import { formatDate } from "@/utils/format";
import type { SupportTicket, TicketStatus } from "@/types";

const ticketStatusLabels: Record<
  TicketStatus,
  { label: string; variant: React.ComponentProps<typeof Badge>["variant"] }
> = {
  open: { label: "Open", variant: "info" },
  awaiting_reply: { label: "Awaiting reply", variant: "warning" },
  resolved: { label: "Resolved", variant: "positive" },
};

export function SupportCenter({
  tickets,
  telegramUrl,
}: {
  /** The account's own conversations. FAQs and help topics stay static copy. */
  tickets: SupportTicket[];
  /** The operator-configured Telegram destination; null when none is set. */
  telegramUrl: string | null;
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

      {/* Tickets — only when the account has any; an empty bordered list
          reads as a broken screen. */}
      {tickets.length > 0 ? (
      <section id="tickets" className="space-y-2 scroll-mt-20">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Your support tickets
        </h2>
        <ul className="divide-y divide-border overflow-hidden rounded-2xl border border-border bg-card">
          {tickets.map((ticket) => {
            const status = ticketStatusLabels[ticket.status];
            return (
              <li key={ticket.id} className="flex items-start gap-3 px-4 py-3.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-foreground">
                  <MessageSquare className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {ticket.subject}
                  </p>
                  <p className="tabular mt-0.5 text-xs text-muted-foreground">
                    {ticket.id} · {ticket.messages} messages
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Badge variant={status.variant}>{status.label}</Badge>
                    <span className="tabular text-[11px] text-muted-foreground">
                      Updated {formatDate(ticket.updatedAt)}
                    </span>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      ) : null}

      {/*
        Contact. These are the channels that reach a person: the Telegram
        account an operator configured, and the support mailbox. There used to
        be an in-app form here that said "Message sent" and stored nothing — a
        customer waiting on a reply to a message nobody received is worse off
        than one who is shown where to write.
      */}
      <section className="space-y-3">
        {telegramUrl ? <TelegramSupportButton url={telegramUrl} /> : null}
        {SUPPORT_EMAIL ? (
          <Button asChild variant={telegramUrl ? "outline" : "brand"} size="lg" block>
            <a href={`mailto:${SUPPORT_EMAIL}`}>
              <Mail className="size-4" aria-hidden />
              Email {SUPPORT_EMAIL}
            </a>
          </Button>
        ) : null}
        {!telegramUrl && !SUPPORT_EMAIL ? (
          <p className="rounded-xl border border-border bg-secondary/60 p-3.5 text-center text-xs leading-relaxed text-muted-foreground">
            Support contact details are being set up. Please check back shortly.
          </p>
        ) : null}
      </section>
    </div>
  );
}
