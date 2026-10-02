"use server";

import { getUsableAccount } from "@/server/auth/account";
import { toSafeFailure } from "@/server/errors";
import { clientAddress, takeToken } from "@/server/rate-limit";
import { revalidate } from "@/server/revalidate";
import { traceAction } from "@/server/trace-action";
import {
  createTicket,
  replyToTicketAsCustomer,
} from "@/server/services/tickets-write.service";
import type { Actor } from "@/server/write";
import type { TicketCategory } from "@/types";

/**
 * Customer support tickets.
 *
 * The owner is the signed-in account, resolved here from the session — the
 * request carries a category, a subject and text, and (for a reply) the id of
 * the ticket to add to, which only ever selects among *this* account's tickets.
 * A restricted account is turned away by `getUsableAccount`, and a burst from
 * one account or address is slowed before the database is touched.
 */
export interface TicketActionResult {
  ok: boolean;
  message: string;
  ticketId?: string;
}

const LIMIT = { attempts: 12, windowMs: 10 * 60 * 1000 };
const SIGN_IN_AGAIN = "Your session has expired. Please sign in again.";
const TRY_AGAIN = "We couldn't send your message right now. Please try again in a moment.";

async function customerActor(): Promise<
  { actor: Actor; userId: string } | { error: string }
> {
  const account = await getUsableAccount();
  if (!account) return { error: SIGN_IN_AGAIN };
  const address = await clientAddress();
  const allowed =
    takeToken(`ticket:${account.userId}`, LIMIT.attempts, LIMIT.windowMs).allowed &&
    takeToken(`ticket-ip:${address}`, LIMIT.attempts * 3, LIMIT.windowMs).allowed;
  if (!allowed) return { error: "You are sending messages too quickly. Please wait a few minutes." };
  return {
    userId: account.userId,
    actor: {
      kind: "user",
      id: account.userId,
      name: account.fullName || account.displayId,
      role: "agent",
    },
  };
}

export async function createTicketAction(input: {
  category: TicketCategory;
  subject: string;
  message: string;
}): Promise<TicketActionResult> {
  return traceAction({ name: "ticket.create", actorType: "user", pipeline: "support" }, async () => {
    const who = await customerActor();
    if ("error" in who) return { ok: false, message: who.error };
    try {
      const { ticketId } = await createTicket(
        {
          userId: who.userId,
          category: input?.category,
          subject: String(input?.subject ?? ""),
          message: String(input?.message ?? ""),
        },
        who.actor,
      );
      revalidate("/settings/support");
      return { ok: true, message: "Your ticket has been sent.", ticketId };
    } catch (error) {
      return { ok: false, message: toSafeFailure(error, TRY_AGAIN).message };
    }
  });
}

export async function replyToTicketAction(input: {
  ticketId: string;
  message: string;
}): Promise<TicketActionResult> {
  return traceAction({ name: "ticket.reply", actorType: "user", pipeline: "support" }, async () => {
    const who = await customerActor();
    if ("error" in who) return { ok: false, message: who.error };
    try {
      await replyToTicketAsCustomer(
        {
          userId: who.userId,
          ticketId: String(input?.ticketId ?? ""),
          message: String(input?.message ?? ""),
        },
        who.actor,
      );
      revalidate("/settings/support", `/settings/support/tickets/${String(input?.ticketId ?? "")}`);
      return { ok: true, message: "Your reply has been sent.", ticketId: input.ticketId };
    } catch (error) {
      return { ok: false, message: toSafeFailure(error, TRY_AGAIN).message };
    }
  });
}
