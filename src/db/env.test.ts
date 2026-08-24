import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  getDatabaseUrl,
  isDatabaseConfigured,
  requireDatabaseUrl,
  shouldUseSsl,
} from "./env";

/**
 * The configuration switch the whole layer turns on.
 *
 * Worth testing directly because getting it wrong is quiet in both directions:
 * a false negative silently serves seed data from a configured database, and a
 * false positive tries to connect on a machine that has none.
 */

const original = { ...process.env };

afterEach(() => {
  process.env = { ...original };
});

test("an unset or blank URL means no database", () => {
  delete process.env.DATABASE_URL;
  assert.equal(getDatabaseUrl(), undefined);
  assert.equal(isDatabaseConfigured(), false);

  // A variable set to whitespace is a common half-configured state, and it
  // must not read as "configured" — postgres.js would fail on connect instead.
  process.env.DATABASE_URL = "   ";
  assert.equal(isDatabaseConfigured(), false);
});

test("a URL means a database", () => {
  process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/nanotron";
  assert.equal(isDatabaseConfigured(), true);
  assert.equal(requireDatabaseUrl(), process.env.DATABASE_URL);
});

test("requiring an absent URL explains how to set one", () => {
  delete process.env.DATABASE_URL;
  assert.throws(requireDatabaseUrl, /\.env\.local/);
});

test("TLS follows the URL unless it is set explicitly", () => {
  process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/nanotron";
  assert.equal(shouldUseSsl(), false);

  process.env.DATABASE_URL =
    "postgresql://user:pw@db.example.com/nanotron?sslmode=require";
  assert.equal(shouldUseSsl(), true);

  process.env.DATABASE_SSL = "false";
  assert.equal(shouldUseSsl(), false);

  process.env.DATABASE_SSL = "true";
  process.env.DATABASE_URL = "postgresql://user:pw@localhost:5432/nanotron";
  assert.equal(shouldUseSsl(), true);
});
