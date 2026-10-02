import type { TicketCategory, TicketStatus } from "@/types";

/**
 * What a support ticket may contain. Shared by the form (to shape the message)
 * and the server (which decides). Pure so it is tested in isolation.
 */
export const TICKET_CATEGORIES: { id: TicketCategory; label: string }[] = [
  { id: "deposit", label: "Deposits" },
  { id: "withdrawal", label: "Withdrawals" },
  { id: "investment", label: "Investments" },
  { id: "verification", label: "Verification (KYC)" },
  { id: "account", label: "Account & security" },
  { id: "other", label: "Something else" },
];

export const TICKET_STATUS_LABELS: Record<TicketStatus, string> = {
  open: "With support",
  awaiting_reply: "Awaiting your reply",
  resolved: "Resolved",
};

export const TICKET_SUBJECT_MIN = 4;
export const TICKET_SUBJECT_MAX = 120;
export const TICKET_BODY_MIN = 10;
export const TICKET_BODY_MAX = 4000;
/** Unresolved tickets one customer may have at a time. */
export const TICKET_OPEN_LIMIT = 5;
/** Messages one ticket may hold — a runaway thread is a mistake or abuse. */
export const TICKET_MESSAGE_LIMIT = 200;

/** How a status is shown: its label and the badge variant that carries it. */
export const TICKET_STATUS_BADGES: Record<
  TicketStatus,
  { label: string; variant: "info" | "warning" | "positive" }
> = {
  open: { label: TICKET_STATUS_LABELS.open, variant: "info" },
  awaiting_reply: { label: TICKET_STATUS_LABELS.awaiting_reply, variant: "warning" },
  resolved: { label: TICKET_STATUS_LABELS.resolved, variant: "positive" },
};

const CATEGORY_IDS = new Set<string>(TICKET_CATEGORIES.map((category) => category.id));

export function isTicketCategory(value: unknown): value is TicketCategory {
  return typeof value === "string" && CATEGORY_IDS.has(value);
}

/** Why a new ticket is refused, or null. Input is untrusted. */
export function newTicketRefusal(input: {
  category: unknown;
  subject: unknown;
  message: unknown;
}): string | null {
  if (!isTicketCategory(input.category)) return "Choose what your ticket is about.";
  const subject = typeof input.subject === "string" ? input.subject.trim() : "";
  if (subject.length < TICKET_SUBJECT_MIN) return "Give your ticket a short subject.";
  if (subject.length > TICKET_SUBJECT_MAX) return `Keep the subject under ${TICKET_SUBJECT_MAX} characters.`;
  return messageRefusal(input.message);
}

/** Why a message body is refused, or null. */
export function messageRefusal(message: unknown): string | null {
  const body = typeof message === "string" ? message.trim() : "";
  if (body.length < TICKET_BODY_MIN) return "Please describe the problem in a little more detail.";
  if (body.length > TICKET_BODY_MAX) return `Keep your message under ${TICKET_BODY_MAX} characters.`;
  return null;
}
