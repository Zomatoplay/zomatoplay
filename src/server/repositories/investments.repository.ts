import "server-only";

import { desc, eq } from "drizzle-orm";

import { schema, type Database } from "@/db";
import type { Investment } from "@/types";
import type { AdminInvestment } from "@/types/admin";

import { toAdminInvestment, toInvestment } from "./mappers";

/** Allocations into plans. */

export async function listInvestmentsForUser(
  db: Database,
  userId: string,
): Promise<Investment[]> {
  const rows = await db
    .select()
    .from(schema.investments)
    .where(eq(schema.investments.userId, userId))
    .orderBy(desc(schema.investments.startedAt));
  return rows.map(toInvestment);
}

/**
 * Every allocation on the platform, with the account it belongs to.
 *
 * The CRM's tables show the holder's name and member id on each row, so the
 * join happens once here rather than as a lookup per rendered row.
 */
export async function listAdminInvestments(
  db: Database,
  options: { limit?: number } = {},
): Promise<AdminInvestment[]> {
  const base = db
    .select({ investment: schema.investments, user: schema.users })
    .from(schema.investments)
    .innerJoin(schema.users, eq(schema.users.id, schema.investments.userId))
    .orderBy(desc(schema.investments.startedAt));
  const rows = options.limit ? await base.limit(options.limit) : await base;

  return rows.map(({ investment, user }) =>
    toAdminInvestment(investment, {
      userName: user.fullName,
      userDisplayId: user.displayId,
    }),
  );
}
