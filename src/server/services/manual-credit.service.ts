import "server-only";

import { desc, eq, or, sql } from "drizzle-orm";

import { getDb } from "@/db";
import { compare, decimal, decimalFrom, isPositive, MoneyError, numericValue, type Decimal } from "@/db/money";
import * as t from "@/db/schema";
import { maskIndianMobile } from "@/lib/phone";
import type { ManualCreditCustomer, ManualCreditRecord } from "@/types/admin";

import { resilientRead } from "../database";
import { applyLedgerEntry, ensureWallet } from "../repositories/wallet.repository";
import { mutate, newId, withReason, type Actor } from "../write";

export type { ManualCreditCustomer, ManualCreditRecord };

/**
 * Manual USDT credits — an operator putting money into a customer's wallet by
 * hand (a deposit that arrived short of its quoted amount, a goodwill credit,
 * a correction).
 *
 * THE SAME MONEY PATH AS EVERYTHING ELSE
 * --------------------------------------
 * Nothing here touches `wallet_balances` directly. The credit is one
 * `applyLedgerEntry` call — a `transactions` row of type `adjustment` and the
 * balance move it explains, in one statement pair — inside the same
 * transaction as the `manual_credits` decision record and its audit entry.
 * All three land or none do, and the ledger still sums to the balance.
 *
 * ONCE, WHATEVER THE NETWORK DOES
 * -------------------------------
 * Every confirmation carries an idempotency key the dialog generated. The
 * `manual_credits` row is inserted first with `ON CONFLICT DO NOTHING` on that
 * key's unique index, and money moves only when the insert actually wrote a
 * row. A double-click, a retried request or two tabs replaying the same
 * confirmation all reach the database; exactly one of them credits, and the
 * others are told it was already applied. The check is the database's, not a
 * prior `SELECT`, which two concurrent requests would both pass.
 *
 * WHO MAY CALL IT
 * ---------------
 * Deciding that is the action's job (`requirePermission("wallet_credits")`),
 * as for every service here. This takes an `Actor` it does not choose.
 */

export class ManualCreditError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ManualCreditError";
  }
}

/**
 * The most a single manual credit may be. A typo guard, not a policy: an extra
 * zero typed into a money field should be refused, not applied and reversed.
 * Larger corrections are several deliberate credits.
 */
export const MAX_MANUAL_CREDIT_USDT = "100000";

/** USDT on TRON carries six decimals; nothing finer can ever be paid out. */
const MAX_CREDIT_DECIMALS = 6;

const NOTE_MAX_LENGTH = 500;

/** The exact amount to credit, or a refusal saying why. Pure. */
export function parseManualCreditAmount(raw: unknown): Decimal {
  const text = typeof raw === "string" ? raw.trim().replace(/,/g, "") : "";
  if (!text) throw new ManualCreditError("Enter an amount.");
  let amount: Decimal;
  try {
    amount = decimal(text);
  } catch (error) {
    if (error instanceof MoneyError) throw new ManualCreditError("Enter a valid USDT amount.");
    throw error;
  }
  if (!isPositive(amount)) {
    throw new ManualCreditError("The amount must be greater than zero.");
  }
  const fraction = amount.split(".")[1] ?? "";
  if (fraction.length > MAX_CREDIT_DECIMALS) {
    throw new ManualCreditError(`USDT amounts have at most ${MAX_CREDIT_DECIMALS} decimal places.`);
  }
  if (compare(amount, decimal(MAX_MANUAL_CREDIT_USDT)) > 0) {
    throw new ManualCreditError(
      `A single manual credit is limited to ${Number(MAX_MANUAL_CREDIT_USDT).toLocaleString("en-IN")} USDT.`,
    );
  }
  return amount;
}

/**
 * A customer id as an operator might type it: the member id support quotes
 * (`NT-1234567`) or the internal account id (`usr_…`). Null when it is
 * neither shape, so nothing malformed reaches a query. Pure.
 */
export function normalizeCustomerId(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (/^nt-\d{7}$/i.test(value)) return value.toUpperCase();
  if (/^usr_[A-Za-z0-9_]{1,60}$/.test(value)) return value;
  return null;
}

/** The dialog's key: a v4 UUID, nothing else. Pure. */
export function isIdempotencyKey(raw: unknown): raw is string {
  return (
    typeof raw === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(raw)
  );
}

/** The operator's note, trimmed and bounded; null when empty. Pure. */
export function normalizeCreditNote(raw: unknown): string | null {
  const value = typeof raw === "string" ? raw.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  if (!value) return null;
  if (value.length > NOTE_MAX_LENGTH) {
    throw new ManualCreditError(`The note is limited to ${NOTE_MAX_LENGTH} characters.`);
  }
  return value;
}

export async function findCustomerForCredit(rawId: unknown): Promise<ManualCreditCustomer | null> {
  const id = normalizeCustomerId(rawId);
  if (!id) throw new ManualCreditError("Enter a member id (NT-1234567) or an account id (usr_…).");

  const rows = await resilientRead(() =>
    getDb()
      .select({
        userId: t.users.id,
        displayId: t.users.displayId,
        fullName: t.users.fullName,
        phoneE164: t.users.phoneE164,
        status: t.users.status,
        kycStatus: t.users.kycStatus,
        available: t.walletBalances.available,
      })
      .from(t.users)
      .leftJoin(t.walletBalances, eq(t.walletBalances.userId, t.users.id))
      .where(or(eq(t.users.id, id), eq(t.users.displayId, id)))
      .limit(2),
  );
  // Ids and member ids are each unique; two rows would mean one account's id
  // is another's member id, and guessing between them is not acceptable here.
  if (rows.length !== 1) return null;
  const row = rows[0];
  return {
    userId: row.userId,
    displayId: row.displayId,
    fullName: row.fullName,
    phone: row.phoneE164 ? maskIndianMobile(row.phoneE164) : null,
    status: row.status,
    kycStatus: row.kycStatus,
    availableUsdt: row.available ?? 0,
  };
}

export interface ManualCreditResult {
  creditId: string;
  ledgerTxId: string;
  amountUsdt: string;
  userId: string;
  displayId: string;
  /** True when this key had already been applied — nothing was credited now. */
  duplicate: boolean;
}

/**
 * Credits `amount` USDT to the account, once per idempotency key.
 *
 * Every input is re-validated here even though the action validated it: this
 * is the layer that moves money, so it does not assume its caller was careful.
 */
export async function creditWalletManually(
  request: {
    userId: string;
    amount: string;
    note?: string | null;
    idempotencyKey: string;
  },
  actor: Actor,
): Promise<ManualCreditResult> {
  if (actor.kind !== "agent") {
    throw new ManualCreditError("Only an operator can credit a wallet.");
  }
  const amount = parseManualCreditAmount(request.amount);
  const note = normalizeCreditNote(request.note);
  if (!isIdempotencyKey(request.idempotencyKey)) {
    throw new ManualCreditError("This confirmation is not valid. Start the credit again.");
  }
  if (typeof request.userId !== "string" || !/^usr_[A-Za-z0-9_]{1,60}$/.test(request.userId)) {
    throw new ManualCreditError("No customer was selected.");
  }

  return mutate(actor, async ({ tx, now, audit }) => {
    // Locked, so a concurrent status change or deletion cannot interleave.
    const [user] = await tx
      .select({ id: t.users.id, displayId: t.users.displayId, fullName: t.users.fullName })
      .from(t.users)
      .where(eq(t.users.id, request.userId))
      .limit(1)
      .for("update");
    if (!user) throw new ManualCreditError("That customer does not exist.");

    /*
     * One credit per key. The advisory lock serialises concurrent requests
     * carrying the same key — a double-click lands as two requests a few
     * milliseconds apart — so the second one waits here, then sees the first
     * one's row and credits nothing. Transaction-scoped: released at commit or
     * rollback, never leaked. The unique index on the key is the backstop: if
     * anything ever slipped past the lock, the insert below would fail and
     * roll the whole credit back.
     */
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${`manual_credit:${request.idempotencyKey}`}, 0))`,
    );

    const [existing] = await tx
      .select({
        id: t.manualCredits.id,
        userId: t.manualCredits.userId,
        amount: sql<string>`${t.manualCredits.amountUsdt}::text`,
        ledgerTxId: t.manualCredits.ledgerTxId,
      })
      .from(t.manualCredits)
      .where(eq(t.manualCredits.idempotencyKey, request.idempotencyKey))
      .limit(1);
    if (existing) {
      if (existing.userId !== user.id || compare(decimalFrom(existing.amount), amount) !== 0) {
        // The same key for a different credit is a client bug or a replay with
        // edited fields. Refused rather than guessed at.
        throw new ManualCreditError(
          "This confirmation was already used for a different credit. Start again.",
        );
      }
      return {
        creditId: existing.id,
        ledgerTxId: existing.ledgerTxId,
        amountUsdt: decimalFrom(existing.amount),
        userId: user.id,
        displayId: user.displayId,
        duplicate: true,
      };
    }

    const creditId = newId("mcr", now);

    await ensureWallet(tx, user.id);
    // The money: one ledger row and the balance move it explains.
    const ledgerTxId = await applyLedgerEntry(tx, {
      userId: user.id,
      type: "adjustment",
      amount,
      description: "Account credit",
      reference: creditId,
      occurredAt: now,
    });

    // The decision, pointing at the entry that carried it out.
    await tx.insert(t.manualCredits).values({
      id: creditId,
      userId: user.id,
      amountUsdt: numericValue(amount),
      note,
      idempotencyKey: request.idempotencyKey,
      ledgerTxId,
      createdById: actor.id,
      createdByName: actor.name,
      createdAt: now,
    });

    audit({
      action: "wallet_manual_credit",
      target: { type: "user", id: user.id, label: `${user.fullName} (${user.displayId})` },
      details: withReason(
        `Manually credited ${amount} USDT to ${user.displayId}. Credit ${creditId}, ledger entry ${ledgerTxId}.`,
        note,
      ),
    });

    return {
      creditId,
      ledgerTxId,
      amountUsdt: amount,
      userId: user.id,
      displayId: user.displayId,
      duplicate: false,
    };
  });
}

/** The most recent manual credits, newest first. The caller has checked `view`. */
export async function listRecentManualCredits(limit = 25): Promise<ManualCreditRecord[]> {
  const rows = await resilientRead(() =>
    getDb()
      .select({
        id: t.manualCredits.id,
        userId: t.manualCredits.userId,
        displayId: t.users.displayId,
        customerName: t.users.fullName,
        amountUsdt: t.manualCredits.amountUsdt,
        note: t.manualCredits.note,
        ledgerTxId: t.manualCredits.ledgerTxId,
        createdByName: t.manualCredits.createdByName,
        createdAt: t.manualCredits.createdAt,
      })
      .from(t.manualCredits)
      .innerJoin(t.users, eq(t.users.id, t.manualCredits.userId))
      .orderBy(desc(t.manualCredits.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100)),
  );
  return rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() }));
}
