import assert from "node:assert/strict";
import { after, before, describe, test } from "node:test";

import { config as loadEnv } from "dotenv";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable, getTableConfig, isPgEnum } from "drizzle-orm/pg-core";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

import { closeAdminDb, createAdminDb, type Database } from "./client";
import { isDatabaseConfigured } from "./env";
import * as schema from "./schema";

/**
 * The live database, checked against the schema that declares it.
 *
 * Migrations are generated, so the SQL and the TypeScript agree by
 * construction — but only until someone edits one of them, or a migration is
 * applied to one environment and not another. This compares what is actually in
 * PostgreSQL against `db/schema/`, in both directions, so drift is a failing
 * test rather than a runtime surprise.
 *
 * Skipped when no database is configured, because the application is designed
 * to run without one (CLAUDE.md §16.3) and `npm test` must stay green on a
 * fresh clone.
 */

const configured = isDatabaseConfigured();
const skip = configured ? false : "no DATABASE_URL configured";

// `as PgTable` rather than a type predicate: the schema's value union is a
// hundred precisely-typed members, and narrowing it structurally is noise here.
const tables = Object.values(schema)
  .filter((value) => is(value, PgTable))
  .map((value) => value as PgTable);

interface DeclaredEnum {
  enumName: string;
  enumValues: readonly string[];
}

const enums = Object.values(schema)
  .filter((value) => isPgEnum(value))
  .map((value) => value as unknown as DeclaredEnum);

describe("schema", { skip }, () => {
  let db: Database;

  before(() => {
    db = createAdminDb();
  });

  after(async () => {
    await closeAdminDb(db);
  });

  test("every declared table exists, and nothing unexpected does", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    const live = new Set(rows.map((row) => row.table_name));
    const declared = tables.map(getTableName);

    /*
     * A floor, not an exact count.
     *
     * This exists to stop the two `deepEqual`s below passing vacuously against
     * an empty set — that is the whole job, and a lower bound does it. An exact
     * figure does not do it any better and has a cost: it fails on every
     * legitimate table addition, in a file whose subject is *drift between the
     * schema and the database*, which is precisely what adding a table is not.
     * Bumping a magic number to make a green suite green again teaches nobody
     * anything, and a suite that cries wolf on correct changes is a suite that
     * gets its failures skimmed.
     *
     * The real assertions are the two set comparisons: declared-but-missing
     * (run `db:migrate`) and present-but-undeclared (someone created a table
     * outside the migrations).
     */
    assert.ok(
      declared.length >= 35,
      `the schema declares ${declared.length} tables, fewer than the 35 that existed when this was written — tables are not deleted here`,
    );

    assert.deepEqual(
      declared.filter((name) => !live.has(name)).sort(),
      [],
      "declared but missing from the database — run `npm run db:migrate`",
    );

    // Drizzle's own migration bookkeeping lives in its `drizzle` schema, so
    // anything extra here is a table someone created outside the migrations.
    assert.deepEqual(
      [...live].filter((name) => !declared.includes(name)).sort(),
      [],
      "present in the database but not declared in the schema",
    );
  });

  test("every enum exists with exactly its declared labels", async () => {
    const rows = await db.execute<{ name: string; labels: string[] }>(sql`
      select t.typname as name, array_agg(e.enumlabel order by e.enumsortorder) as labels
      from pg_type t
      join pg_namespace n on n.oid = t.typnamespace
      join pg_enum e on e.enumtypid = t.oid
      where t.typtype = 'e' and n.nspname = 'public'
      group by t.typname
    `);
    const live = new Map(rows.map((row) => [row.name, row.labels]));

    assert.equal(enums.length, 44, "the schema should declare 44 enums");

    for (const declared of enums) {
      const labels = live.get(declared.enumName);
      assert.ok(labels, `enum ${declared.enumName} is missing`);
      // Order matters: it is what Postgres sorts and compares by.
      assert.deepEqual(
        labels,
        [...declared.enumValues],
        `enum ${declared.enumName} has drifted`,
      );
    }
  });

  test("every foreign key exists and points where the schema says", async () => {
    const rows = await db.execute<{
      table_name: string;
      column_name: string;
      foreign_table: string;
      foreign_column: string;
    }>(sql`
      select
        c.conrelid::regclass::text  as table_name,
        a.attname                   as column_name,
        c.confrelid::regclass::text as foreign_table,
        af.attname                  as foreign_column
      from pg_constraint c
      join pg_namespace n  on n.oid = c.connamespace
      join unnest(c.conkey)  with ordinality as k(attnum, ord)  on true
      join unnest(c.confkey) with ordinality as fk(attnum, ord) on fk.ord = k.ord
      join pg_attribute a  on a.attrelid  = c.conrelid  and a.attnum  = k.attnum
      join pg_attribute af on af.attrelid = c.confrelid and af.attnum = fk.attnum
      where c.contype = 'f' and n.nspname = 'public'
    `);

    const live = new Set(
      rows.map(
        (row) =>
          `${row.table_name}.${row.column_name}->${row.foreign_table}.${row.foreign_column}`,
      ),
    );

    const declared: string[] = [];
    for (const table of tables) {
      const name = getTableName(table);
      for (const key of getTableConfig(table).foreignKeys) {
        const reference = key.reference();
        const target = getTableName(reference.foreignTable);
        reference.columns.forEach((column, index) => {
          declared.push(
            `${name}.${column.name}->${target}.${reference.foreignColumns[index].name}`,
          );
        });
      }
    }

    // A floor, for the same reason as the table count above: it guards against
    // a vacuous comparison, and an exact figure would fail on every legitimate
    // foreign key added afterwards.
    assert.ok(
      declared.length >= 29,
      `the schema declares ${declared.length} foreign keys, fewer than the 29 that existed when this was written`,
    );

    assert.deepEqual(
      declared.filter((key) => !live.has(key)).sort(),
      [],
      "declared foreign keys missing from the database",
    );
    assert.equal(live.size, declared.length, "unexpected foreign keys in database");
  });

  test("every table has a primary key", async () => {
    const rows = await db.execute<{ table_name: string }>(sql`
      select c.conrelid::regclass::text as table_name
      from pg_constraint c
      join pg_namespace n on n.oid = c.connamespace
      where c.contype = 'p' and n.nspname = 'public'
    `);
    const live = new Set(rows.map((row) => row.table_name));

    for (const table of tables) {
      assert.ok(live.has(getTableName(table)), `${getTableName(table)} has no primary key`);
    }
  });

  test("every declared index exists", async () => {
    const rows = await db.execute<{ indexname: string }>(
      sql`select indexname from pg_indexes where schemaname = 'public'`,
    );
    const live = new Set(rows.map((row) => row.indexname));

    const declared = tables.flatMap((table) =>
      getTableConfig(table).indexes.map((index) => index.config.name),
    );

    assert.ok(declared.length > 0);
    assert.deepEqual(
      declared.filter((name) => name && !live.has(name)).sort(),
      [],
      "declared indexes missing from the database",
    );
  });

  test("money columns are numeric, never floating point", async () => {
    // The one schema property that is silently destructive if it regresses:
    // a float8 balance column would round USDT amounts and no test of the
    // application would notice until the numbers stopped adding up.
    const rows = await db.execute<{ table_name: string; column_name: string; data_type: string }>(sql`
      select table_name, column_name, data_type
      from information_schema.columns
      where table_schema = 'public'
        and (column_name like '%usdt%' or column_name like '%inr%'
             or column_name in ('available', 'amount', 'profit', 'projected_profit',
                                'total_deposited', 'total_invested', 'total_withdrawn',
                                'total_profit', 'locked_in_investments', 'min_investment',
                                'max_investment', 'min_deposit', 'invested_amount',
                                'earned_from_referral', 'next_reward_amount'))
    `);

    assert.ok(rows.length > 20, "expected many money columns");
    for (const row of rows) {
      assert.equal(
        row.data_type,
        "numeric",
        `${row.table_name}.${row.column_name} is ${row.data_type}`,
      );
    }
  });
});
