import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

// Deliberately does NOT load .env.local: this file owns `process.env` and
// drives the switch by hand.
import { plans as seedPlans } from "@/data/plans";
import { closeDb } from "@/db";

import { getPlans } from "./services/catalogue.service";

/**
 * The two properties of `fromDatabase()` that everything else rests on.
 *
 * They pull in opposite directions and are easy to get backwards, which is why
 * they are pinned here rather than left to a comment:
 *
 *   1. No database configured  → serve the seed modules, quietly.
 *   2. Database configured but broken → fail, loudly.
 *
 * Getting (2) wrong is the dangerous one. A service that fell back on error
 * would render a plausible page from mock data during a real outage, and the
 * first person to notice would be a user reading someone else's balance.
 */

const original = process.env.DATABASE_URL;

afterEach(async () => {
  if (original === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = original;
  // The client is cached per URL, so it has to be dropped between cases.
  await closeDb();
});

test("with no DATABASE_URL, services serve the seed data", async () => {
  delete process.env.DATABASE_URL;
  await closeDb();

  const plans = await getPlans();

  assert.equal(plans.length, seedPlans.length);
  assert.deepEqual(
    plans.map((plan) => plan.slug),
    seedPlans.map((plan) => plan.slug),
  );
});

test("a blank DATABASE_URL counts as no database, not as a broken one", async () => {
  process.env.DATABASE_URL = "   ";
  await closeDb();

  const plans = await getPlans();
  assert.equal(plans.length, seedPlans.length);
});

test("a configured but unreachable database fails instead of faking it", async () => {
  // Port 1 refuses immediately, so this stays fast and deterministic.
  process.env.DATABASE_URL = "postgresql://user:pw@127.0.0.1:1/nanotron";
  await closeDb();

  await assert.rejects(
    () => getPlans(),
    (error: unknown) => {
      assert.ok(error instanceof Error);
      // Whatever it is, it must not be a quietly-substituted seed array.
      return true;
    },
    "a failing query must propagate, never fall back to @/data",
  );
});

test("an unresponsive database fails on a deadline rather than hanging", async () => {
  // A port that blackholes rather than refusing: the connection never
  // completes and postgres.js keeps retrying, which is the shape that hung a
  // production render until `fromDatabase` grew a deadline.
  process.env.DATABASE_URL = "postgresql://user:pw@10.255.255.1:5432/nanotron";
  process.env.DATABASE_QUERY_TIMEOUT_MS = "2000";
  await closeDb();

  const started = Date.now();
  await assert.rejects(() => getPlans());
  const elapsed = Date.now() - started;

  assert.ok(elapsed < 15_000, `should give up promptly, took ${elapsed}ms`);
  delete process.env.DATABASE_QUERY_TIMEOUT_MS;
});

test("the failure is not cached into a permanent outage", async () => {
  process.env.DATABASE_URL = "postgresql://user:pw@127.0.0.1:1/nanotron";
  await closeDb();
  await assert.rejects(() => getPlans());

  // Removing the configuration returns the app to the seed data rather than
  // leaving the broken client in place.
  delete process.env.DATABASE_URL;
  await closeDb();
  const plans = await getPlans();
  assert.equal(plans.length, seedPlans.length);
});
