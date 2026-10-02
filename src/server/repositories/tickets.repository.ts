import "server-only";

import { and, asc, count, desc, eq, ne } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { SupportTicket, TicketDetail, TicketMessage, TicketStatus } from "@/types";
import type { AdminTicket } from "@/types/admin";

import { toSupportTicket } from "./mappers";

/**
 * Support tickets — reads. Every customer-side read takes the owner's id and
 * puts it in the `WHERE`; there is no query here that finds a ticket by id
 * alone for a customer, so a guessed id belongs to nobody but its owner.
 */

type MessageRow = typeof schema.ticketMessages.$inferSelect;

function toTicketMessage(row: MessageRow): TicketMessage {
  return {
    id: row.id,
    author: row.author,
    authorName: row.authorName,
    body: row.body,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One of the customer's own tickets with its conversation, or null. */
export async function findTicketForUser(
  db: Database,
  userId: string,
  ticketId: string,
): Promise<TicketDetail | null> {
  const [row] = await db
    .select()
    .from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.id, ticketId), eq(schema.supportTickets.userId, userId)))
    .limit(1);
  if (!row) return null;
  const messages = await db
    .select()
    .from(schema.ticketMessages)
    .where(eq(schema.ticketMessages.ticketId, row.id))
    .orderBy(asc(schema.ticketMessages.createdAt), asc(schema.ticketMessages.id));
  return { ticket: toSupportTicket(row), messages: messages.map(toTicketMessage) };
}

/** Tickets that still need the customer's attention or support's. */
export async function countOpenTicketsForUser(db: Database, userId: string): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(schema.supportTickets)
    .where(and(eq(schema.supportTickets.userId, userId), ne(schema.supportTickets.status, "resolved")));
  return row?.value ?? 0;
}

/* ------------------------------ Console ------------------------------ */

const ADMIN_LIST_LIMIT = 100;

function toAdminTicket(row: {
  ticket: typeof schema.supportTickets.$inferSelect;
  customerId: string;
  customerName: string;
  customerDisplayId: string;
}): AdminTicket {
  return {
    ...toSupportTicket(row.ticket),
    customer: { id: row.customerId, name: row.customerName, displayId: row.customerDisplayId },
  };
}

/**
 * The newest tickets, most recently active first, optionally one status. The
 * queue is read in one bounded page — the status chip counts come from
 * `countTicketsByStatus`, so a filtered list never understates the others.
 */
export async function listAdminTickets(
  db: Database,
  status?: TicketStatus,
): Promise<AdminTicket[]> {
  const rows = await db
    .select({
      ticket: schema.supportTickets,
      customerId: schema.users.id,
      customerName: schema.users.fullName,
      customerDisplayId: schema.users.displayId,
    })
    .from(schema.supportTickets)
    .innerJoin(schema.users, eq(schema.users.id, schema.supportTickets.userId))
    .where(status ? eq(schema.supportTickets.status, status) : undefined)
    .orderBy(desc(schema.supportTickets.updatedAt))
    .limit(ADMIN_LIST_LIMIT);
  return rows.map(toAdminTicket);
}

export async function countTicketsByStatus(
  db: Database,
): Promise<Record<TicketStatus, number>> {
  const rows = await db
    .select({ status: schema.supportTickets.status, value: count() })
    .from(schema.supportTickets)
    .groupBy(schema.supportTickets.status);
  const totals: Record<TicketStatus, number> = { open: 0, awaiting_reply: 0, resolved: 0 };
  for (const row of rows) totals[row.status] = row.value;
  return totals;
}

export async function findAdminTicket(
  db: Database,
  ticketId: string,
): Promise<{ ticket: AdminTicket; messages: TicketMessage[] } | null> {
  const [row] = await db
    .select({
      ticket: schema.supportTickets,
      customerId: schema.users.id,
      customerName: schema.users.fullName,
      customerDisplayId: schema.users.displayId,
    })
    .from(schema.supportTickets)
    .innerJoin(schema.users, eq(schema.users.id, schema.supportTickets.userId))
    .where(eq(schema.supportTickets.id, ticketId))
    .limit(1);
  if (!row) return null;
  const messages = await db
    .select()
    .from(schema.ticketMessages)
    .where(eq(schema.ticketMessages.ticketId, ticketId))
    .orderBy(asc(schema.ticketMessages.createdAt), asc(schema.ticketMessages.id));
  return { ticket: toAdminTicket(row), messages: messages.map(toTicketMessage) };
}

export type { SupportTicket };
