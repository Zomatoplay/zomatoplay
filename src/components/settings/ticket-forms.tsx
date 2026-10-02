"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  TICKET_BODY_MAX,
  TICKET_CATEGORIES,
  TICKET_SUBJECT_MAX,
  messageRefusal,
  newTicketRefusal,
} from "@/lib/ticket-rules";
import { cn } from "@/lib/utils";
import {
  createTicketAction,
  replyToTicketAction,
} from "@/app/(app)/settings/support/actions";
import type { TicketCategory } from "@/types";

const NETWORK_ERROR =
  "Connection interrupted. Please check your internet connection and try again.";

/** New ticket: what it is about, a subject, and the first message. */
export function NewTicketForm() {
  const router = useRouter();
  const [category, setCategory] = useState<TicketCategory | "">("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const refusal = newTicketRefusal({ category, subject, message });
    if (refusal) {
      setError(refusal);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await createTicketAction({
        category: category as TicketCategory,
        subject,
        message,
      }).catch(() => null);
      if (!result) {
        setError(NETWORK_ERROR);
        return;
      }
      if (!result.ok || !result.ticketId) {
        setError(result.message);
        return;
      }
      toast.success("Ticket sent", { description: "We'll reply here. You can check back any time." });
      router.replace(`/settings/support/tickets/${result.ticketId}`);
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-5" noValidate>
      <div className="space-y-2">
        <Label htmlFor="ticket-category">What is this about?</Label>
        <select
          id="ticket-category"
          value={category}
          onChange={(event) => setCategory(event.target.value as TicketCategory | "")}
          disabled={pending}
          className={cn(
            "flex h-12 w-full rounded-xl border border-input bg-card px-4 text-base text-foreground",
            "focus-visible:border-ring focus-visible:outline-2 focus-visible:outline-ring/40",
            category === "" && "text-muted-foreground",
          )}
        >
          <option value="" disabled>
            Choose a topic
          </option>
          {TICKET_CATEGORIES.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-2">
        <Label htmlFor="ticket-subject">Subject</Label>
        <Input
          id="ticket-subject"
          value={subject}
          maxLength={TICKET_SUBJECT_MAX}
          onChange={(event) => setSubject(event.target.value)}
          placeholder="A short summary"
          autoComplete="off"
          disabled={pending}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="ticket-message">Message</Label>
        <Textarea
          id="ticket-message"
          value={message}
          maxLength={TICKET_BODY_MAX}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Tell us what happened. Include the amount, date and any reference (for example a deposit request ID)."
          rows={6}
          disabled={pending}
        />
        <p className="text-xs leading-relaxed text-muted-foreground">
          Never share your OTP, withdrawal password or private keys. We will never ask for them.
        </p>
      </div>

      {error ? (
        <p role="alert" className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}

      <Button type="submit" variant="brand" size="lg" block disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        {pending ? "Sending…" : "Send ticket"}
      </Button>
    </form>
  );
}

/** Reply on an existing ticket. A reply to a resolved ticket reopens it. */
export function TicketReplyForm({ ticketId, resolved }: { ticketId: string; resolved: boolean }) {
  const router = useRouter();
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (pending) return;
    const refusal = messageRefusal(message);
    if (refusal) {
      setError(refusal);
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await replyToTicketAction({ ticketId, message }).catch(() => null);
      if (!result) {
        setError(NETWORK_ERROR);
        return;
      }
      if (!result.ok) {
        setError(result.message);
        return;
      }
      setMessage("");
      toast.success("Reply sent");
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-3" noValidate>
      <Label htmlFor="ticket-reply">{resolved ? "Reopen with a reply" : "Your reply"}</Label>
      <Textarea
        id="ticket-reply"
        value={message}
        maxLength={TICKET_BODY_MAX}
        onChange={(event) => setMessage(event.target.value)}
        rows={4}
        disabled={pending}
      />
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <Button type="submit" variant="brand" size="lg" block disabled={pending}>
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        {pending ? "Sending…" : "Send reply"}
      </Button>
    </form>
  );
}
