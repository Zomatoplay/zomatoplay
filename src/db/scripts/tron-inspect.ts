import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Reads Shasta and reports what the scanner would make of it. Changes nothing.
 *
 *   npm run tron:inspect
 *
 * Read-only by construction, not by promise: it never imports the deposits
 * service and never opens a database transaction. That matters because the
 * question it answers — "why has my test transfer not shown up?" — is one you
 * want to ask repeatedly against a live configuration without wondering whether
 * asking it changed anything.
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

main().catch((error) => {
  console.error("Inspect failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
