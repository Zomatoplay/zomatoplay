import assert from "node:assert/strict";
import { test } from "node:test";

import { getTableName, is } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";

import { currentUser } from "@/data/user";

import * as schema from "../schema";

import type { Database } from "../client";
import { seedDatabase } from "./index";

/**
 * The seed, exercised without a database.
 *
 * There is no PostgreSQL server in CI or on a fresh clone, and the seed is the
 * one piece of this layer whose correctness is not fully expressible in types:
 * it reconciles two mock datasets that overlap, and a mistake there produces a
 * foreign key violation halfway through a real run. So it is run here against a
 * recorder that captures what *would* be written, and the result is checked for
 * the properties a database would otherwise have to reject.
 *
 * Run with `npm test`.
 */

interface Recorder {
  db: Database;
  rows: Map<string, Record<string, unknown>[]>;
  deletions: string[];
}

function recorder(): Recorder {
  const rows = new Map<string, Record<string, unknown>[]>();
  const deletions: string[] = [];

  const fake = {
    delete(table: PgTable) {
      deletions.push(getTableName(table));
      return Promise.resolve();
    },
    insert(table: PgTable) {
      const name = getTableName(table);
      return {
        values(values: Record<string, unknown>[]) {
          rows.set(name, [...(rows.get(name) ?? []), ...values]);
          return Promise.resolve();
        },
      };
    },
  };

  // The seed uses exactly two of Drizzle's methods; the recorder implements
  // those two and nothing else, so any third would fail loudly here rather
  // than quietly do nothing.
  return { db: fake as unknown as Database, rows, deletions };
}

function ids(rows: Record<string, unknown>[] | undefined, key = "id") {
  return new Set((rows ?? []).map((row) => String(row[key])));
}

test("every table in the schema is seeded", async () => {
  const { db, rows } = recorder();
  const report = await seedDatabase(db);

  for (const [table, count] of Object.entries(report)) {
    assert.equal(
      rows.get(table)?.length ?? 0,
      count,
      `${table}: report says ${count} rows`,
    );
    assert.ok(count > 0, `${table} seeded no rows`);
  }

  // Counted from the schema rather than hard-coded, so adding a table without
  // seeding it fails here instead of leaving a silently empty screen.
  const declared = Object.values(schema)
    .filter((value) => is(value, PgTable))
    .map((table) => getTableName(table as PgTable));

  /**
   * Tables the seed deliberately leaves empty.
   *
   * All three are written by processes rather than by fixtures, and seeding
   * them would be inventing history: `investment_earnings` records accruals
   * the engine has paid, `chain_scan_state` is the scanner's cursor — which
   * must start absent so the first poll reads its configured lookback window
   * rather than resuming from a position nothing ever scanned — and
   * `pipeline_events` is the record of what the system actually did. A fixture
   * there would make the one screen that exists to diagnose real problems the
   * one screen guaranteed to be fiction. `plan_rate_history` is the same shape
   * again: it exists to say who changed a plan's rate and when
   * (`db/schema/plans.ts`), and no operator has ever edited a seeded plan — a
   * fixture row would invent a change that did not happen, on the one table
   * whose entire purpose is recording that a change genuinely did.
   * `deposit_addresses` is the same again: it exists to say which real address
   * belongs to which real account, and no seeded fixture account has ever
   * asked for a deposit address or been handed one from the pool.
   * `deposit_address_assignments` follows `deposit_addresses` necessarily —
   * it records the intervals during which a real account held a real address,
   * and a fixture interval would be a claim about who owned a deposit.
   * `deposit_requests` is a customer's own intention to pay a specific amount,
   * and `deposit_settings` is an operator's choice of the address real money
   * goes to — a seeded row would be, respectively, a deposit nobody started and
   * a receiving address nobody chose.
   * `manual_credits` is an operator's decision to put money in a wallet, and
   * `withdrawal_passwords` a secret a customer set after an SMS code — a
   * fixture would be, respectively, a credit nobody made and a credential
   * nobody chose.
   * `plan_duration_rates` holds the return an operator chose for each term;
   * a seeded figure would be a rate nobody set (CLAUDE.md §10e).
   */
  const operational = new Set([
    "plan_duration_rates",
    "manual_credits",
    "withdrawal_passwords",
    "investment_earnings",
    "chain_scan_state",
    "pipeline_events",
    "plan_rate_history",
    "deposit_addresses",
    "deposit_address_assignments",
    "deposit_requests",
    "deposit_settings",
  ]);

  assert.deepEqual(
    declared.filter((table) => !operational.has(table) && !(table in report)),
    [],
    "tables declared in the schema but never seeded",
  );
  assert.deepEqual(
    [...operational].filter((table) => table in report),
    [],
    "operational tables must not be seeded with invented history",
  );
});

test("clears children before parents", async () => {
  const { db, deletions } = recorder();
  await seedDatabase(db);

  const before = (child: string, parent: string) =>
    assert.ok(
      deletions.indexOf(child) < deletions.indexOf(parent),
      `${child} must be cleared before ${parent}`,
    );

  before("wallet_balances", "users");
  before("investments", "users");
  before("kyc_documents", "kyc_submissions");
  before("kyc_submissions", "users");
  before("admin_agent_permissions", "admin_agents");
  before("investments", "plans");
  before("commission_entries", "users");
});

test("every foreign key resolves", async () => {
  const { db, rows } = recorder();
  await seedDatabase(db);

  const userIds = ids(rows.get("users"));
  const planIds = ids(rows.get("plans"));
  const submissionIds = ids(rows.get("kyc_submissions"));
  const agentIds = ids(rows.get("admin_agents"));

  const references: [string, string, Set<string>, boolean][] = [
    ["wallet_balances", "userId", userIds, false],
    ["bank_accounts", "userId", userIds, false],
    ["wallet_addresses", "userId", userIds, false],
    ["user_kyc_steps", "userId", userIds, false],
    ["user_device_sessions", "userId", userIds, false],
    ["user_security_events", "userId", userIds, false],
    ["support_tickets", "userId", userIds, false],
    ["user_notification_preferences", "userId", userIds, false],
    ["notifications", "userId", userIds, false],
    ["investments", "userId", userIds, false],
    ["investments", "planId", planIds, false],
    ["transactions", "userId", userIds, false],
    ["deposits", "userId", userIds, false],
    ["withdrawals", "userId", userIds, false],
    ["kyc_submissions", "userId", userIds, false],
    ["kyc_documents", "submissionId", submissionIds, false],
    ["kyc_notes", "submissionId", submissionIds, false],
    ["referral_accounts", "userId", userIds, false],
    ["referrals", "referrerUserId", userIds, false],
    ["referrals", "referredUserId", userIds, true],
    ["commission_entries", "beneficiaryUserId", userIds, false],
    ["commission_entries", "sourceUserId", userIds, true],
    ["admin_agent_permissions", "agentId", agentIds, false],
  ];

  for (const [table, column, parents, nullable] of references) {
    for (const row of rows.get(table) ?? []) {
      const value = row[column];
      if (value === null && nullable) continue;
      assert.ok(
        parents.has(String(value)),
        `${table}.${column} = ${String(value)} has no parent row`,
      );
    }
  }
});

test("primary keys are unique", async () => {
  const { db, rows } = recorder();
  await seedDatabase(db);

  for (const table of [
    "users",
    "plans",
    "investments",
    "transactions",
    "deposits",
    "withdrawals",
    "kyc_submissions",
    "kyc_documents",
    "kyc_notes",
    "referrals",
    "commission_entries",
    "notifications",
    "admin_agents",
    "audit_logs",
    "notification_campaigns",
  ]) {
    const table_rows = rows.get(table) ?? [];
    assert.equal(
      ids(table_rows).size,
      table_rows.length,
      `${table} has duplicate ids`,
    );
  }

  // Composite keys.
  const steps = (rows.get("user_kyc_steps") ?? []).map(
    (row) => `${row.userId}/${row.stepId}`,
  );
  assert.equal(new Set(steps).size, steps.length);

  const grants = (rows.get("admin_agent_permissions") ?? []).map(
    (row) => `${row.agentId}/${row.permission}`,
  );
  assert.equal(new Set(grants).size, grants.length);
});

test("unique columns on users hold", async () => {
  const { db, rows } = recorder();
  await seedDatabase(db);
  const users = rows.get("users") ?? [];

  for (const column of ["email", "displayId", "referralCode"]) {
    assert.equal(
      ids(users, column).size,
      users.length,
      `users.${column} is not unique`,
    );
  }
});

test("the demo account's wallet reconciles against its allocations", async () => {
  const { db, rows } = recorder();
  await seedDatabase(db);

  const wallet = (rows.get("wallet_balances") ?? []).find(
    (row) => row.userId === currentUser.id,
  );
  assert.ok(wallet, "the demo account has no wallet");

  // The reason the CRM's version of these allocations is dropped in favour of
  // the user application's: only the latter adds up to the locked balance the
  // wallet reports. If this fails, the two datasets have been reconciled the
  // wrong way round.
  const locked = (rows.get("investments") ?? [])
    .filter((row) => row.userId === currentUser.id && row.status === "active")
    .reduce((sum, row) => sum + Number(row.amount), 0);

  assert.equal(locked, wallet.lockedInInvestments);
});

test("overlapping records are stored once", async () => {
  const { db, rows } = recorder();
  await seedDatabase(db);

  // `sec_1…4` and `sev_2001…2004` describe the same four events.
  const events = rows.get("user_security_events") ?? [];
  const moments = events.map((row) => `${row.userId}/${String(row.createdAt)}`);
  assert.equal(new Set(moments).size, moments.length, "duplicated security events");

  // The CRM ledger and the user's history share two commission entries.
  const commissions = rows.get("commission_entries") ?? [];
  const payments = commissions.map(
    (row) => `${row.beneficiaryUserId}/${String(row.createdAt)}/${row.amountUsdt}`,
  );
  assert.equal(new Set(payments).size, payments.length, "duplicated commissions");

  // One referral edge per relationship, not one per dataset that mentions it.
  const referrals = rows.get("referrals") ?? [];
  const edges = referrals
    .filter((row) => row.referredUserId !== null)
    .map((row) => `${row.referrerUserId}->${row.referredUserId}`);
  assert.equal(new Set(edges).size, edges.length, "duplicated referral edges");
});

test("exactly one platform settings row", async () => {
  const { db, rows } = recorder();
  await seedDatabase(db);

  const settings = rows.get("platform_settings") ?? [];
  assert.equal(settings.length, 1);
  assert.equal(settings[0].id, "default");
});
