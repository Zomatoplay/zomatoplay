import "server-only";

import { and, eq, ne, sql } from "drizzle-orm";

import * as t from "@/db/schema";
import {
  TICKET_MESSAGE_LIMIT,
  TICKET_OPEN_LIMIT,
  messageRefusal,
  newTicketRefusal,
} from "@/lib/ticket-rules";
import type { TicketCategory, TicketStatus } from "@/types";

import { mutate, newId, withReason, type Actor } from "../write";

/**
 * Support tickets — every write.
 *
 * OWNERSHIP IS IN THE SQL
 * -----------------------
 * A customer-side write names the owner in its own `WHERE user_id = …`, taken
 * from the session by the caller. A ticket id that is not the caller's matches
 * no row and is reported as "not found" — the same answer as one that does not
 * exist, so ids cannot be probed.
 *
 * STATUS MEANS WHO MOVES NEXT
 * ---------------------------
 * `open` — support's turn (new, or the customer replied; a reply also reopens a
 * resolved ticket). `awaiting_reply` — support answered, the customer's turn.
 * `resolved` — closed. Message counts and the status change in the same
 * transaction as the message, so a ticket never disagrees with its thread.
 */

export class TicketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TicketError";
  }
}

const NOT_FOUND = "That ticket could not be found.";

export async function createTicket(
  request: { userId: string; category: TicketCategory; subject: string; message: string },
  actor: Actor,
): Promise<{ ticketId: string }> {
  const refusal = newTicketRefusal(request);
  if (refusal) throw new TicketError(refusal);

  return mutate(actor, async ({ tx, now }) => {
    // Serialises one customer's creates so the limit cannot be raced past.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ticket-create:${request.userId}`}))`);

    const [open] = await tx
      .select({ value: sql<number>`count(*)::int` })
      .from(t.supportTickets)
      .where(and(eq(t.supportTickets.userId, request.userId), ne(t.supportTickets.status, "resolved")));
    if ((open?.value ?? 0) >= TICKET_OPEN_LIMIT) {
      throw new TicketError(
        `You already have ${TICKET_OPEN_LIMIT} open tickets. Please wait for a reply, or add to one of them.`,
      );
    }

    const ticketId = newId("TKT", now).toUpperCase();
    await tx.insert(t.supportTickets).values({
      id: ticketId,
      userId: request.userId,
      subject: request.subject.trim(),
      category: request.category,
      status: "open",
      createdAt: now,
      updatedAt: now,
      messageCount: 1,
    });
    await tx.insert(t.ticketMessages).values({
      id: newId("tmsg", now),
      ticketId,
      author: "customer",
      authorName: null,
      body: request.message.trim(),
      createdAt: now,
    });
    return { ticketId };
  });
}

export async function replyToTicketAsCustomer(
  request: { userId: string; ticketId: string; message: string },
  actor: Actor,
): Promise<void> {
  const refusal = messageRefusal(request.message);
  if (refusal) throw new TicketError(refusal);

  await mutate(actor, async ({ tx, now }) => {
    const [ticket] = await tx
      .update(t.supportTickets)
      // A customer reply always puts the ticket back in support's queue,
      // including one that had been resolved.
      .set({ status: "open", updatedAt: now, messageCount: sql`${t.supportTickets.messageCount} + 1` })
      .where(
        and(
          eq(t.supportTickets.id, request.ticketId),
          eq(t.supportTickets.userId, request.userId),
          sql`${t.supportTickets.messageCount} < ${TICKET_MESSAGE_LIMIT}`,
        ),
      )
      .returning({ id: t.supportTickets.id });
    if (!ticket) {
      throw new TicketError(
        `${NOT_FOUND} It may also have reached the ${TICKET_MESSAGE_LIMIT}-message limit — please open a new ticket.`,
      );
    }
    await tx.insert(t.ticketMessages).values({
      id: newId("tmsg", now),
      ticketId: request.ticketId,
      author: "customer",
      authorName: null,
      body: request.message.trim(),
      createdAt: now,
    });
  });
}

export async function replyToTicketAsSupport(
  request: { ticketId: string; message: string; resolve?: boolean },
  actor: Actor,
): Promise<void> {
  if (actor.kind !== "agent") throw new TicketError("Only an operator can reply as support.");
  const refusal = messageRefusal(request.message);
  if (refusal) throw new TicketError(refusal);

  await mutate(actor, async ({ tx, now, audit }) => {
    const nextStatus: TicketStatus = request.resolve ? "resolved" : "awaiting_reply";
    const [ticket] = await tx
      .update(t.supportTickets)
      .set({ status: nextStatus, updatedAt: now, messageCount: sql`${t.supportTickets.messageCount} + 1` })
      .where(eq(t.supportTickets.id, request.ticketId))
      .returning({ id: t.supportTickets.id, subject: t.supportTickets.subject });
    if (!ticket) throw new TicketError(NOT_FOUND);

    await tx.insert(t.ticketMessages).values({
      id: newId("tmsg", now),
      ticketId: request.ticketId,
      author: "support",
      authorName: actor.name,
      body: request.message.trim(),
      createdAt: now,
    });

    audit({
      action: "ticket_replied",
      target: { type: "ticket", id: ticket.id, label: `${ticket.id} · ${ticket.subject}` },
      details: request.resolve ? "Replied and resolved the ticket." : "Replied to the customer.",
    });
  });
}

export async function setTicketStatus(
  request: { ticketId: string; status: TicketStatus; reason?: string },
  actor: Actor,
): Promise<void> {
  if (actor.kind !== "agent") throw new TicketError("Only an operator can change a ticket's status.");

  await mutate(actor, async ({ tx, now, audit }) => {
    const [before] = await tx
      .select({ id: t.supportTickets.id, subject: t.supportTickets.subject, status: t.supportTickets.status })
      .from(t.supportTickets)
      .where(eq(t.supportTickets.id, request.ticketId))
      .limit(1)
      .for("update");
    if (!before) throw new TicketError(NOT_FOUND);
    if (before.status === request.status) return;

    await tx
      .update(t.supportTickets)
      .set({ status: request.status, updatedAt: now })
      .where(eq(t.supportTickets.id, before.id));

    audit({
      action: "ticket_status_changed",
      target: { type: "ticket", id: before.id, label: `${before.id} · ${before.subject}` },
      details: withReason(`Status changed from ${before.status} to ${request.status}.`, request.reason),
    });
  });
}
