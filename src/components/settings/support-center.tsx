"use client";

import { useState } from "react";
import { Mail, MessageSquare, Send } from "lucide-react";
import { toast } from "sonner";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { TelegramSupportButton } from "@/components/shared/telegram-support";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
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
  const [contactOpen, setContactOpen] = useState(false);
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");

  const canSubmit = subject.trim().length > 3 && message.trim().length > 10;

  function handleSubmit() {
    setContactOpen(false);
    setSubject("");
    setMessage("");
    toast.success("Message sent", {
      description: "Demo build — no ticket was actually created.",
    });
  }

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

      {/* Tickets */}
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

      {/* Contact */}
      <section className="space-y-3">
        {telegramUrl ? <TelegramSupportButton url={telegramUrl} /> : null}
        <Button variant="brand" size="lg" block onClick={() => setContactOpen(true)}>
          <Send className="size-4" />
          Contact support
        </Button>
        <p className="flex items-center justify-center gap-1.5 text-xs text-muted-foreground">
          <Mail className="size-3.5" aria-hidden />
          {SUPPORT_EMAIL}
        </p>
      </section>

      <Sheet open={contactOpen} onOpenChange={setContactOpen}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Contact support</SheetTitle>
            <SheetDescription>
              Tell us what happened and we will get back to you.
            </SheetDescription>
          </SheetHeader>
          <SheetBody className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="ticket-subject">Subject</Label>
              <Input
                id="ticket-subject"
                value={subject}
                onChange={(event) => setSubject(event.target.value)}
                placeholder="What do you need help with?"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ticket-message">Message</Label>
              <Textarea
                id="ticket-message"
                value={message}
                onChange={(event) => setMessage(event.target.value)}
                placeholder="Include any transaction IDs that are relevant."
                rows={5}
              />
            </div>
          </SheetBody>
          <SheetFooter>
            <Button
              variant="brand"
              size="lg"
              block
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              Send message
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>
    </div>
  );
}
