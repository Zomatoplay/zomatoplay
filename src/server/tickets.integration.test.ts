import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { and, eq } from "drizzle-orm";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, closeDb, createAdminDb, isDatabaseConfigured } from "@/db";
import type { Database } from "@/db";
import * as t from "@/db/schema";
import { TICKET_OPEN_LIMIT } from "@/lib/ticket-rules";

import { findAdminTicket, findTicketForUser } from "./repositories/tickets.repository";
import {
  TicketError,
  createTicket,
  replyToTicketAsCustomer,
  replyToTicketAsSupport,
  setTicketStatus,
} from "./services/tickets-write.service";
import { newId, type Actor } from "./write";

/**
 * Support tickets against the real database: ownership lives in the SQL, the
 * status says who moves next, every operator action is audited, and the
 * per-customer limit cannot be raced past. Throwaway accounts, removed after.
 */

const skip = isDatabaseConfigured() ? false : "no DATABASE_URL configured";

const OPERATOR: Actor = { kind: "agent", id: "agt_ticket_test", name: "Ticket Test Operator", role: "master_admin" };
const BODY = "I sent 25 USDT an hour ago and it has not arrived in my wallet.";

describe("support tickets", { skip }, () => {
  let db: Database;
  const users: string[] = [];

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    for (const id of users) {
      await db.delete(t.auditLogs).where(eq(t.auditLogs.targetId, id));
      await db.delete(t.users).where(eq(t.users.id, id)); // tickets + messages cascade
    }
    await db.delete(t.auditLogs).where(eq(t.auditLogs.actorId, OPERATOR.id));
    await closeAdminDb(db);
    await closeDb();
  });

  async function makeUser() {
    const id = newId("usr_tk");
    const suffix = id.slice(-10);
    await db.insert(t.users).values({
      id,
      displayId: `NT-T${suffix}`,
      fullName: "Ticket Test",
      phone: "+91 00000 00000",
      registeredAt: new Date(),
      lastActiveAt: new Date(),
      referralCode: `TK${suffix}`.toUpperCase(),
      walletAddress: `T${suffix}`,
    });
    users.push(id);
    return id;
  }
  const actorFor = (userId: string): Actor => ({ kind: "user", id: userId, name: "Customer", role: "agent" });

  test("creating a ticket stores it open, with its first message, under the caller", async () => {
    const userId = await makeUser();
    const { ticketId } = await createTicket(
      { userId, category: "deposit", subject: "Deposit missing", message: BODY },
      actorFor(userId),
    );
    const detail = await findTicketForUser(db, userId, ticketId);
    assert.ok(detail);
    assert.equal(detail.ticket.status, "open");
    assert.equal(detail.ticket.category, "deposit");
    assert.equal(detail.ticket.messages, 1);
    assert.equal(detail.messages.length, 1);
    assert.equal(detail.messages[0].author, "customer");
  });

  test("another customer can neither read nor reply to it — it simply is not found", async () => {
    const owner = await makeUser();
    const stranger = await makeUser();
    const { ticketId } = await createTicket(
      { userId: owner, category: "account", subject: "Private matter", message: BODY },
      actorFor(owner),
    );
    assert.equal(await findTicketForUser(db, stranger, ticketId), null);
    await assert.rejects(
      replyToTicketAsCustomer({ userId: stranger, ticketId, message: BODY }, actorFor(stranger)),
      (error: unknown) => error instanceof TicketError,
    );
    const detail = await findTicketForUser(db, owner, ticketId);
    assert.equal(detail?.messages.length, 1, "the stranger's reply must not have been stored");
  });

  test("support replies move it to awaiting-reply and are audited; a customer reply puts it back with support", async () => {
    const userId = await makeUser();
    const { ticketId } = await createTicket(
      { userId, category: "withdrawal", subject: "Where is my payout", message: BODY },
      actorFor(userId),
    );

    await replyToTicketAsSupport({ ticketId, message: "We are checking this and will update you." }, OPERATOR);
    let detail = await findTicketForUser(db, userId, ticketId);
    assert.equal(detail?.ticket.status, "awaiting_reply");
    assert.equal(detail?.messages.at(-1)?.author, "support");
    assert.equal(detail?.messages.at(-1)?.authorName, OPERATOR.name);

    const audits = await db
      .select()
      .from(t.auditLogs)
      .where(and(eq(t.auditLogs.targetId, ticketId), eq(t.auditLogs.action, "ticket_replied")));
    assert.equal(audits.length, 1);

    await replyToTicketAsCustomer({ userId, ticketId, message: "Thanks, any news on this today?" }, actorFor(userId));
    detail = await findTicketForUser(db, userId, ticketId);
    assert.equal(detail?.ticket.status, "open");
    assert.equal(detail?.ticket.messages, 3);
  });

  test("resolving is audited, and a customer reply reopens a resolved ticket", async () => {
    const userId = await makeUser();
    const { ticketId } = await createTicket(
      { userId, category: "other", subject: "General question", message: BODY },
      actorFor(userId),
    );
    await setTicketStatus({ ticketId, status: "resolved", reason: "Answered by phone" }, OPERATOR);
    assert.equal((await findAdminTicket(db, ticketId))?.ticket.status, "resolved");

    const [audit] = await db
      .select()
      .from(t.auditLogs)
      .where(and(eq(t.auditLogs.targetId, ticketId), eq(t.auditLogs.action, "ticket_status_changed")));
    assert.match(audit.details, /Answered by phone/);

    await replyToTicketAsCustomer({ userId, ticketId, message: "Actually this is still happening." }, actorFor(userId));
    assert.equal((await findAdminTicket(db, ticketId))?.ticket.status, "open");
  });

  test("a customer cannot act as support", async () => {
    const userId = await makeUser();
    const { ticketId } = await createTicket(
      { userId, category: "other", subject: "Sneaky one", message: BODY },
      actorFor(userId),
    );
    await assert.rejects(
      replyToTicketAsSupport({ ticketId, message: "I am support now, honest." }, actorFor(userId)),
      (error: unknown) => error instanceof TicketError,
    );
    await assert.rejects(
      setTicketStatus({ ticketId, status: "resolved" }, actorFor(userId)),
      (error: unknown) => error instanceof TicketError,
    );
  });

  test("the open-ticket limit holds, even under a burst", async () => {
    const userId = await makeUser();
    const attempts = await Promise.allSettled(
      Array.from({ length: TICKET_OPEN_LIMIT + 3 }, (_, index) =>
        createTicket(
          { userId, category: "other", subject: `Burst ticket ${index}`, message: BODY },
          actorFor(userId),
        ),
      ),
    );
    assert.equal(attempts.filter((a) => a.status === "fulfilled").length, TICKET_OPEN_LIMIT);
    const stored = await db.select().from(t.supportTickets).where(eq(t.supportTickets.userId, userId));
    assert.equal(stored.length, TICKET_OPEN_LIMIT);
  });

  test("invalid input is refused before anything is written", async () => {
    const userId = await makeUser();
    await assert.rejects(
      createTicket({ userId, category: "deposit", subject: "x", message: BODY }, actorFor(userId)),
      (error: unknown) => error instanceof TicketError,
    );
    const stored = await db.select().from(t.supportTickets).where(eq(t.supportTickets.userId, userId));
    assert.equal(stored.length, 0);
  });
});
