import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyError,
  isInfrastructureFailure,
  isRetryable,
  toSafeFailure,
} from "./errors";
import { describeError, errorDiagnostics, redact } from "./observability";

/**
 * The line between "the answer is no" and "we could not find out".
 *
 * Needs no database, deliberately: every case here is about how a thrown value
 * is *interpreted*, and that must not depend on whether a network happens to be
 * up while the suite runs.
 *
 * The scenario these were written for is a real production failure. On
 * 2026-09-14 an operator's sign-in failed five times in eighty seconds and the
 * browser showed them:
 *
 *   Failed query: select "admin_agents"."id", … where "auth_user_id" = $1
 *   params: 84555b4d-c50d-4486-9f15-59f0e61c3616
 *
 * Their credentials were fine. The Supabase session pooler had refused a
 * connection. Two things had to be true for that to reach a person: the
 * refusal was not classified as an infrastructure fault, and the sign-in
 * action returned `error.message` verbatim.
 */

/** The exact shape postgres.js produces when Supavisor refuses a client. */
function poolExhausted(): Error {
  return Object.assign(
    new Error(
      "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15",
    ),
    { code: "XX000", name: "PostgresError", severity_local: "FATAL" },
  );
}

/** How that arrives after Drizzle has wrapped it. */
function wrappedPoolExhausted(): Error {
  return new Error(
    'Failed query: select "admin_agents"."id" from "admin_agents" where "auth_user_id" = $1\nparams: 84555b4d-c50d-4486-9f15-59f0e61c3616',
    { cause: poolExhausted() },
  );
}

test("classification", async (t) => {
  await t.test("a full pooler is a database outage, not a server error", () => {
    assert.equal(classifyError(poolExhausted()), "DATABASE_UNAVAILABLE");
    assert.equal(classifyError(wrappedPoolExhausted()), "DATABASE_UNAVAILABLE");
    assert.equal(isRetryable(classifyError(wrappedPoolExhausted())), true);
    assert.equal(isInfrastructureFailure(wrappedPoolExhausted()), true);
  });

  await t.test("a refused permission is not an infrastructure failure", () => {
    const denied = Object.assign(new Error("No manage access to withdrawals."), {
      name: "AdminAuthorizationError",
    });
    assert.equal(classifyError(denied), "PERMISSION_DENIED");
    assert.equal(isInfrastructureFailure(denied), false);
    assert.equal(isRetryable(classifyError(denied)), false);
  });

  await t.test("an ordinary internal error stays a server error", () => {
    // The guard on the fix above: `XX000` without the pooler's message is a
    // genuine fault and must not be dressed up as a transient outage.
    const internal = Object.assign(new Error("internal error in tuplesort"), {
      code: "XX000",
    });
    assert.equal(classifyError(internal), "SERVER_ERROR");
    assert.equal(isInfrastructureFailure(internal), false);
  });
});

test("what a person is allowed to be shown", async (t) => {
  await t.test("never leaks SQL or bound parameters", () => {
    const failure = toSafeFailure(wrappedPoolExhausted(), "Sign-in failed.");

    assert.equal(failure.category, "DATABASE_UNAVAILABLE");
    assert.equal(failure.retryable, true);
    // The three things that actually reached a browser on 2026-09-14.
    assert.ok(!failure.message.includes("Failed query"));
    assert.ok(!failure.message.includes("admin_agents"));
    assert.ok(!failure.message.includes("84555b4d"));
    // And it still says something a person can act on.
    assert.match(failure.message, /try again/i);
  });

  await t.test("this application's own refusals are shown verbatim", () => {
    // The allowlist has to let real product messages through, or the fix
    // would replace a leak with a screen that explains nothing.
    const refusal = Object.assign(new Error("A submission is already under review."), {
      name: "KycError",
    });
    assert.equal(
      toSafeFailure(refusal, "Could not submit.").message,
      "A submission is already under review.",
    );

    const denied = Object.assign(
      new Error("Priya does not have manage access to withdrawals."),
      { name: "AdminAuthorizationError" },
    );
    assert.equal(
      toSafeFailure(denied, "The decision was not recorded.").message,
      "Priya does not have manage access to withdrawals.",
    );
  });

  await t.test("an unrecognised error falls back to the caller's wording", () => {
    const odd = new TypeError("cannot read properties of undefined");
    const failure = toSafeFailure(odd, "The address was not released.");
    assert.equal(failure.message, "The address was not released.");
    assert.ok(!failure.message.includes("undefined"));
  });
});

test("what an operator is allowed to see", async (t) => {
  await t.test("the cause chain is recorded, not just the wrapper", () => {
    /*
     * The other half of the production defect: the browser saw too much and
     * the system log saw too little. Every database failure was recorded as
     * Drizzle's "Failed query: …" with the SQLSTATE thrown away, which is why
     * the fault went undiagnosed for weeks.
     */
    const described = describeError(wrappedPoolExhausted());
    assert.match(described, /Failed query/);
    assert.match(described, /caused by/);
    assert.match(described, /PostgresError \(XX000\)/);
    assert.match(described, /EMAXCONNSESSION/);
  });

  await t.test("the code is filterable, not only readable", () => {
    const diagnostics = errorDiagnostics(wrappedPoolExhausted());
    assert.equal(diagnostics.errorCode, "XX000");
    assert.equal(diagnostics.errorName, "PostgresError");
    assert.equal(diagnostics.errorSeverity, "FATAL");
  });

  await t.test("a connection string in a driver error is still redacted", () => {
    // `describeError` walks further than the old one-liner did, so it has more
    // chances to pick up something that must not be stored. Every level goes
    // through `redact()`.
    const leaky = new Error("outer", {
      cause: new Error(
        "connection failed: postgres://user:hunter2@db.example.com:5432/postgres",
      ),
    });
    const described = describeError(leaky);
    assert.ok(!described.includes("hunter2"));
    assert.match(described, /postgres:\/\/\[redacted\]/);
    assert.ok(!redact("password=hunter2").includes("hunter2"));
  });

  await t.test("bound query parameters never reach the log", () => {
    /*
     * `pipeline_events` contained rows reading `params: b0271b3e-…,1` — a real
     * `auth_user_id`, written by a failed account lookup. Not a credential,
     * which is why none of the other redaction rules caught it, and still
     * account-identifying data in a table an operator browses.
     *
     * The statement is kept deliberately: which query failed is the entire
     * diagnostic value, and it is schema rather than data.
     */
    const wrapped = new Error(
      'Failed query: select "id" from "users" where "users"."auth_user_id" = $1 limit $2\n' +
        "params: b0271b3e-7a1d-43b3-a7a3-a6bbe3988d54,1",
      { cause: Object.assign(new Error("boom"), { code: "57014" }) },
    );

    const described = describeError(wrapped);
    assert.ok(!described.includes("b0271b3e"), described);
    assert.match(described, /params: \[redacted\]/);
    // The statement survives — that is what makes the row worth keeping.
    assert.match(described, /select "id" from "users"/);

    // Directly, too, since `redact` is the backstop for text this code did
    // not compose.
    assert.ok(!redact("params: usr_8c41a2,TQw6kB9nM3v").includes("usr_8c41a2"));
  });

  await t.test("a self-referential cause does not hang the describer", () => {
    const loop: Error & { cause?: unknown } = new Error("loop");
    loop.cause = loop;
    assert.equal(describeError(loop), "Error: loop");
  });
});
