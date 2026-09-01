import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Reads Shasta and reports what the scanner would make of it.
 *
 *   npm run tron:inspect          the last 24 hours
 *   npm run tron:inspect -- 336   …looking back two weeks
 *
 * THE LOOKBACK IS THE FIRST THING TO CHECK
 * ----------------------------------------
 * The window defaults to 24 hours and is passed to TronGrid as `min_timestamp`,
 * so a transfer older than it is not reported and the output reads exactly like
 * "nothing arrived". A real test transfer was chased for a while on the
 * strength of that: it was eleven days old, present on-chain, and already
 * recorded in the database. Widen the window before concluding anything.
 *
 * IT RECORDS NO DEPOSIT — BUT IT IS NOT SILENT
 * --------------------------------------------
 * It never imports the deposits service and never opens a transaction, so no
 * deposit, ledger entry or balance can change. It does write `pipeline_events`
 * rows, because every TronGrid call is instrumented; that opens the runtime
 * connection pool, which is why the script now closes it explicitly. Without
 * that it held session-mode connections — a slice of a project-wide budget of
 * fifteen — and never exited.
 */
async function main() {
  const { describeTronConfig, getTronConfig, isTronConfigured } = await import(
    "../../server/tron/config"
  );
  const { parseTransfer, REJECTION_LABELS } = await import(
    "../../server/tron/parse"
  );
  const {
    fetchHeadBlockNumber,
    fetchSolidBlockNumber,
    fetchTransactionBlock,
    fetchTrc20Transfers,
  } = await import("../../server/tron/trongrid");

  if (!isTronConfigured()) {
    console.log(
      "TRON is not configured. Set TRON_USDT_CONTRACT and " +
        "TRON_PLATFORM_DEPOSIT_ADDRESS in .env.local — see .env.example.",
    );
    return;
  }

  const config = getTronConfig();
  const described = describeTronConfig(config);

  console.log("Configuration");
  console.log("  network            :", described.network);
  console.log("  TronGrid           :", described.gridUrl);
  // Presence only — the key itself never reaches stdout.
  console.log("  API key            :", described.apiKeyConfigured ? "set" : "not set (low rate limit)");
  console.log("  USDT contract      :", described.usdtContract);
  console.log("  deposit address    :", described.depositAddress);
  console.log("  require confirmation:", described.requireConfirmation);

  const [head, solid] = await Promise.all([
    fetchHeadBlockNumber(config),
    fetchSolidBlockNumber(config),
  ]);
  console.log("\nChain");
  console.log("  head block         :", head.toString());
  console.log("  solidified block   :", solid.toString(), `(${head - solid} behind)`);

  const sinceHours = Number(process.argv[2] ?? 24);
  const since = Date.now() - sinceHours * 60 * 60 * 1000;
  console.log(`\nTRC-20 transfers to the deposit address, last ${sinceHours}h`);

  const { transfers } = await fetchTrc20Transfers(config, {
    address: config.depositAddress,
    contract: config.usdtContract,
    minTimestamp: since,
  });

  if (transfers.length === 0) {
    console.log("  (none)");
    console.log(
      "\n  Nothing here does not mean nothing arrived: this query is already\n" +
        "  filtered to the configured contract. Re-run with the contract filter\n" +
        "  removed if a transfer is missing and you suspect the wrong token.",
    );
    return;
  }

  for (const raw of transfers) {
    const parsed = parseTransfer(raw, config);
    if (!parsed.ok) {
      console.log(
        `  ✗ ${raw.transaction_id ?? "(no id)"} — skipped: ` +
          `${REJECTION_LABELS[parsed.reason]}${parsed.detail ? ` (${parsed.detail})` : ""}`,
      );
      continue;
    }

    const { transfer } = parsed;
    const block = await fetchTransactionBlock(config, transfer.txHash);
    const solidified = block !== null && block.blockNumber <= solid;
    const wouldRecord = !config.requireConfirmation || solidified;

    console.log(`  ✓ ${transfer.txHash}`);
    console.log(`      amount    ${transfer.amount} ${transfer.tokenSymbol ?? "?"}`);
    console.log(`      from      ${transfer.from}`);
    console.log(`      to        ${transfer.to}`);
    console.log(
      `      block     ${block?.blockNumber?.toString() ?? "not indexed yet"}` +
        (block ? ` — ${solidified ? "solidified" : "not yet solidified"}` : ""),
    );
    console.log(
      `      scanner   ${wouldRecord ? "would record as an unassigned deposit" : "would wait for solidification"}`,
    );
  }

  console.log(
    "\nNothing above was written. Run `npm run tron:scan` to record deposits,\n" +
      "then attribute them to a user in the CRM at /admin/deposits.",
  );
}

main()
  .catch((error) => {
    console.error("Inspect failed:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    /*
     * Close the pool the instrumentation opened.
     *
     * `idle_timeout` is 0 — connections are never closed for being idle, which
     * is what keeps navigation fast in the server and what kept this script
     * alive forever. A CLI must hand its connections back: they come out of the
     * same project-wide allowance of fifteen as the application, the scanner
     * and the test suite.
     */
    const { flushPipelineEvents } = await import("../../server/observability");
    const { closeDb } = await import("../client");
    // Drain first: the flush itself needs the pool, and it runs on an unref'd
    // timer that would otherwise fire after the close and reopen it.
    await flushPipelineEvents().catch(() => {});
    await closeDb().catch(() => {});
  });
