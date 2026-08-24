import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });
loadEnv({ path: ".env", quiet: true });

/**
 * Runs the deposit scanner.
 *
 *   npm run tron:scan            one pass, then exit
 *   npm run tron:scan -- --watch poll on TRON_POLL_INTERVAL_MS
 *   npm run tron:scan -- --dry   read and report, write nothing
 *
 * Deposits it records are **unassigned**. Nothing is credited to anyone until
 * an operator attributes it in the CRM.
 */
async function main() {
  const watch = process.argv.includes("--watch");
  const dryRun = process.argv.includes("--dry");

  const { getTronConfig } = await import("../../server/tron/config");
  const { formatScanSummary, scanDeposits } = await import(
    "../../server/tron/scanner"
  );
  const { closeDb } = await import("../client");

  const interval = getTronConfig().pollIntervalMs;

  async function pass() {
    const started = Date.now();
    try {
      const summary = await scanDeposits({ dryRun });
      console.log(
        `[${new Date().toISOString()}] ${dryRun ? "(dry run) " : ""}` +
          formatScanSummary(summary).replace(/\n/g, "\n  ") +
          `\n  took ${Date.now() - started}ms`,
      );
    } catch (error) {
      // Reported, never swallowed: a failed pass must not look like a quiet one.
      console.error(
        `[${new Date().toISOString()}] scan failed:`,
        error instanceof Error ? error.message : error,
      );
      if (!watch) throw error;
    }
  }

  if (!watch) {
    await pass();
    await closeDb();
    return;
  }

  console.log(`Polling every ${interval}ms. Ctrl-C to stop.`);
  for (;;) {
    await pass();
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

main().catch((error) => {
  console.error("Scan failed:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
