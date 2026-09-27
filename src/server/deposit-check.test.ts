import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { readFile } from "node:fs/promises";

import { createScanTrigger } from "./tron/scan-trigger";
import type { ScanSummary } from "./tron/scanner";

/**
 * The deposit screen's 30-second check.
 *
 * Three things are worth pinning here, and nothing else is:
 *
 *  1. **The limits on triggering a scan from a request.** A scan is global and
 *     spends TronGrid quota and database connections, so a page that asks for
 *     one every thirty seconds — times however many people have the screen
 *     open — must not turn into that many passes.
 *  2. **The action refuses an unauthenticated caller, and takes no argument
 *     that could name a different one.** Identity comes from the session or
 *     the call does not proceed.
 *
 * Crediting itself is not re-tested here: `deposit-request.integration.test.ts`
 * owns "the same transaction hash is only ever credited once", "two concurrent
 * recordings credit exactly once" and the matching rules, which are properties
 * of `recordObservedDeposit`, not of this screen.
 */

function summary(created = 0): ScanSummary {
  return {
    scanned: created,
    created,
    updated: 0,
    unchanged: 0,
    pending: 0,
    rejected: {},
    solidBlock: "1",
    errors: [],
  };
}

describe("triggering the scanner from an open deposit screen", () => {
  test("concurrent checks join one pass rather than starting several", async () => {
    let passes = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const trigger = createScanTrigger(async () => {
      passes += 1;
      await gate;
      return summary(1);
    });

    // Ten people with the screen open, all ticking at once.
    const calls = Promise.all(Array.from({ length: 10 }, () => trigger()));
    release?.();
    const results = await calls;

    assert.equal(passes, 1, "one pass, however many callers asked for it");
    assert.equal(results.filter((r) => r.outcome === "scanned").length, 1);
    assert.equal(results.filter((r) => r.outcome === "joined").length, 9);
    // A joined caller still gets the pass's real result, not an empty one.
    for (const result of results) assert.equal(result.summary?.created, 1);
  });

  test("a check arriving too soon after the last pass does not start another", async () => {
    let passes = 0;
    let clock = 1_000_000;
    const trigger = createScanTrigger(
      async () => {
        passes += 1;
        return summary();
      },
      { minIntervalMs: 20_000, now: () => clock },
    );

    assert.equal((await trigger()).outcome, "scanned");

    clock += 19_999;
    const early = await trigger();
    assert.equal(early.outcome, "throttled");
    assert.equal(early.summary, null, "a throttled check must not claim a pass ran");
    assert.equal(passes, 1);

    // The client polls every 30s, so its own next tick is always past the floor.
    clock += 30_000;
    assert.equal((await trigger()).outcome, "scanned");
    assert.equal(passes, 2);
  });

  test("a failing scan is reported, not thrown, and does not wedge the trigger", async () => {
    let clock = 0;
    let attempts = 0;
    const trigger = createScanTrigger(
      async () => {
        attempts += 1;
        if (attempts === 1) throw new Error("TronGrid is rate limiting");
        return summary();
      },
      { minIntervalMs: 20_000, now: () => clock },
    );

    const failed = await trigger();
    assert.equal(failed.outcome, "failed");
    assert.match(failed.error ?? "", /rate limiting/);

    // A failure counts against the floor too: an endpoint rejecting instantly
    // would otherwise be retried on every poll of every open screen.
    assert.equal((await trigger()).outcome, "throttled");

    clock += 20_000;
    assert.equal((await trigger()).outcome, "scanned", "one bad pass is not fatal");
  });
});

describe("the deposit check action", () => {
  test("refuses a caller with no session, and never scans for one", async () => {
    const { checkDepositRequestAction } = await import(
      "@/app/(app)/wallet/deposit/actions"
    );

    const result = await checkDepositRequestAction({
      requestId: "DEP-00000000",
      requestScan: true,
    });

    assert.equal(result.ok, false, "an unauthenticated caller must be refused");
    assert.equal(result.request, undefined, "and told nothing about any request");
    assert.equal(result.newDeposits.length, 0);
  });

  test("the verify and create actions refuse a caller with no session", async () => {
    const { submitDepositHashAction, createDepositRequestAction } = await import(
      "@/app/(app)/wallet/deposit/actions"
    );
    const verify = await submitDepositHashAction({
      requestId: "DEP-00000000",
      txHash: "a".repeat(64),
    });
    assert.equal(verify.ok, false);
    const create = await createDepositRequestAction({ amount: "100" });
    assert.equal(create.ok, false);
  });
});

/**
 * The cheap read and the expensive chain scan are separate cadences.
 *
 * Measured 2026-09-13: a real pass costs p50 3,891 ms, and at one scan per
 * 5-second tick the deposit screen drove a chain scan roughly every 9 s for as
 * long as it was open — to find transfers that cannot be credited until their
 * block solidifies ~57 s later. These tests pin the split so it cannot quietly
 * collapse back into one call.
 */
describe("the deposit screen's two cadences", () => {
  test("the client's scan interval stays above the server's floor, and its poll below", async () => {
    const { DEPOSIT_SCAN_MIN_INTERVAL_MS } = await import(
      "@/server/tron/scan-trigger"
    );

    // Read out of the component so the two cannot drift apart unnoticed.
    const source = await readFile(
      new URL("../components/wallet/deposit-flow.tsx", import.meta.url),
      "utf8",
    );
    const poll = Number(
      /const POLL_INTERVAL_MS = ([\d_]+)/.exec(source)?.[1].replace(/_/g, ""),
    );
    const scan = Number(
      /const SCAN_INTERVAL_MS = ([\d_]+)/.exec(source)?.[1].replace(/_/g, ""),
    );

    assert.ok(Number.isFinite(poll) && Number.isFinite(scan), "both intervals found");

    assert.ok(
      poll < DEPOSIT_SCAN_MIN_INTERVAL_MS,
      `the cheap poll (${poll}ms) must be faster than the scan floor ` +
        `(${DEPOSIT_SCAN_MIN_INTERVAL_MS}ms) — that is the whole point of splitting them`,
    );
    assert.ok(
      scan > DEPOSIT_SCAN_MIN_INTERVAL_MS,
      `the scan request interval (${scan}ms) must clear the server floor ` +
        `(${DEPOSIT_SCAN_MIN_INTERVAL_MS}ms), or a screen's own request is refused`,
    );
    assert.ok(
      scan >= 57_000,
      `a chain scan more often than ~57s cannot produce an earlier answer: ` +
        `nothing is credited before its block solidifies (got ${scan}ms)`,
    );
  });

  test("a tick that does not request a scan runs none", async () => {
    let passes = 0;
    const { createScanTrigger } = await import("@/server/tron/scan-trigger");
    const trigger = createScanTrigger(async () => {
      passes += 1;
      return {
        scanned: 0, created: 0, updated: 0, unchanged: 0, pending: 0,
        rejected: {}, solidBlock: null, errors: [],
      };
    });

    // The action skips `triggerDepositScan` entirely when `requestScan` is
    // false; this asserts the trigger's own contract that nothing runs unless
    // it is called.
    assert.equal(passes, 0, "no pass before anyone asks");
    await trigger();
    assert.equal(passes, 1, "and exactly one when a slow tick does ask");
  });
});
