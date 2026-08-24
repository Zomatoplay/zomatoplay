import "server-only";

import { and, eq, sql } from "drizzle-orm";

import { getDb, isDatabaseConfigured } from "@/db";
import * as t from "@/db/schema";
import { timestampValue } from "@/db/sql-values";

import {
  recordObservedDeposit,
  type RecordOutcome,
} from "../services/deposits.service";
import { recordPipelineEvent, withTrace } from "../observability";
import { newId } from "../write";
import { getTronConfig, isTronConfigured, type TronConfig } from "./config";
import { parseTransfer, REJECTION_LABELS, type RejectionReason } from "./parse";
import {
  fetchSolidBlockNumber,
  fetchTransactionBlock,
  fetchTrc20Transfers,
  TronGridError,
} from "./trongrid";

/**
 * The deposit scanner.
 *
 * Polls TronGrid for TRC-20 transfers into the platform address, filters them
 * against the configured contract and recipient, and records the ones that pass
 * once they are irreversible.
 *
 * WHY POLLING
 * -----------
 * TRON has no push notification worth relying on, and a websocket or queue
 * would be infrastructure to operate before there is anything to operate it
 * for. A poll is restartable, has no state to lose — the cursor is an
 * optimisation, not a correctness mechanism — and its failure mode is delay
 * rather than loss.
 *
 * WHAT MAKES IT SAFE
 * ------------------
 * - It never advances its cursor past a page it failed to fetch. A rate-limit
 *   response is an error, not an empty result.
 * - It records nothing until the transfer's block is solidified, when the
 *   confirmation policy is on.
 * - Recording is idempotent at the database level, so an overlapping window,
 *   a retry, or two scanners running at once cannot double-credit.
 * - It never assigns a user. That is an operator decision.
 */

export interface ScanSummary {
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  pending: number;
  rejected: Partial<Record<RejectionReason, number>>;
  solidBlock: string | null;
  errors: string[];
}

export class ScannerUnavailableError extends Error {}

const CURSOR_OVERLAP_MS = 60_000;

/**
 * Runs one pass.
 *
 * Returns a summary rather than logging: the CLI prints it, a scheduler can
 * record it, and a test can assert on it.
 */
export async function scanDeposits(
  options: { dryRun?: boolean } = {},
): Promise<ScanSummary> {
  // One correlation id per pass, so every event a tick produces — the head
  // block read, each deposit recorded, the cursor write — is one filter.
  return withTrace(
    { actorType: "system", route: null },
    () => runScan(options),
  );
}

async function runScan(options: { dryRun?: boolean }): Promise<ScanSummary> {
  if (!isTronConfigured()) {
    throw new ScannerUnavailableError(
      "TRON is not configured. Set TRON_USDT_CONTRACT and " +
        "TRON_PLATFORM_DEPOSIT_ADDRESS — see .env.example.",
    );
  }
  if (!options.dryRun && !isDatabaseConfigured()) {
    throw new ScannerUnavailableError(
      "No DATABASE_URL, so there is nowhere to record deposits.",
    );
  }

  const config = getTronConfig();
  const summary: ScanSummary = {
    scanned: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    pending: 0,
    rejected: {},
    solidBlock: null,
    errors: [],
  };

  const cursor = options.dryRun ? null : await readCursor(config);
  const since =
    cursor?.lastTimestamp
      ? cursor.lastTimestamp.getTime() - CURSOR_OVERLAP_MS
      : Date.now() - config.lookbackMs;

  let solidBlock: bigint;
  try {
    solidBlock = await fetchSolidBlockNumber(config);
    summary.solidBlock = solidBlock.toString();
  } catch (error) {
    await noteFailure(config, error, options.dryRun);
    throw error;
  }

  let highestTimestamp = cursor?.lastTimestamp?.getTime() ?? 0;
  let pageUrl: string | undefined;

  try {
    // Bounded: a runaway cursor or a very busy address must not turn one tick
    // into an unbounded crawl.
    for (let page = 0; page < 20; page += 1) {
      const { transfers, nextUrl } = await fetchTrc20Transfers(config, {
        address: config.depositAddress,
        contract: config.usdtContract,
        minTimestamp: since > 0 ? since : undefined,
        pageUrl,
      });

      for (const raw of transfers) {
        summary.scanned += 1;

        const parsed = parseTransfer(raw, config);
        if (!parsed.ok) {
          summary.rejected[parsed.reason] =
            (summary.rejected[parsed.reason] ?? 0) + 1;
          continue;
        }

        const { transfer } = parsed;
        highestTimestamp = Math.max(
          highestTimestamp,
          transfer.blockTimestamp?.getTime() ?? 0,
        );

        // The listing carries no block number, so solidity needs one more call.
        const block = await fetchTransactionBlock(config, transfer.txHash);
        const confirmed =
          !config.requireConfirmation ||
          (block !== null && block.blockNumber <= solidBlock);

        if (!confirmed) {
          // Deliberately not recorded as a credited-able deposit yet. The next
          // pass will see it again — the overlap window exists for this.
          summary.pending += 1;
          continue;
        }

        if (options.dryRun) {
          summary.created += 1;
          continue;
        }

        const result = await recordObservedDeposit({
          txHash: transfer.txHash,
          from: transfer.from,
          to: transfer.to,
          contract: transfer.contract,
          tokenSymbol: transfer.tokenSymbol,
          amount: transfer.amount,
          blockNumber: block?.blockNumber ?? null,
          blockTimestamp:
            transfer.blockTimestamp ??
            (block?.blockTimestamp ? new Date(block.blockTimestamp) : null),
          network: config.network,
          confirmed: true,
          confirmationsRequired: config.requireConfirmation ? 1 : 0,
        });

        countOutcome(summary, result.outcome);
      }

      if (!nextUrl) break;
      pageUrl = nextUrl;
    }
  } catch (error) {
    // The cursor is not advanced. Whatever was missed is re-read next pass;
    // treating a failure as "nothing arrived" is how a scanner loses deposits.
    await noteFailure(config, error, options.dryRun);
    throw error;
  }

  if (!options.dryRun) {
    await advanceCursor(config, highestTimestamp, solidBlock);
  }

  // A pass that found nothing and a scanner that has been broken since Tuesday
  // look identical in a log of deposits. This is what tells them apart.
  recordPipelineEvent({
    pipeline: "chain_scanner",
    operation: options.dryRun ? "chain.scan.dry_run" : "chain.scan",
    status: summary.errors.length > 0 ? "failed" : "ok",
    message:
      summary.errors.length > 0
        ? "Scan pass completed with errors"
        : `Scanned ${summary.scanned} transfer${summary.scanned === 1 ? "" : "s"}`,
    errorMessage: summary.errors.length > 0 ? summary.errors.join("; ") : null,
    metadata: {
      scanned: summary.scanned,
      created: summary.created,
      updated: summary.updated,
      unchanged: summary.unchanged,
      pendingConfirmation: summary.pending,
      dryRun: Boolean(options.dryRun),
      solidBlock: summary.solidBlock ?? "unknown",
    },
  });

  return summary;
}

function countOutcome(summary: ScanSummary, outcome: RecordOutcome) {
  if (outcome === "created") summary.created += 1;
  else if (outcome === "updated") summary.updated += 1;
  else summary.unchanged += 1;
}

/** Renders a summary for a human. */
export function formatScanSummary(summary: ScanSummary): string {
  const lines = [
    `scanned ${summary.scanned} transfer(s)`,
    `  recorded   ${summary.created}`,
    `  updated    ${summary.updated}`,
    `  unchanged  ${summary.unchanged}`,
    `  awaiting confirmation ${summary.pending}`,
  ];
  const rejected = Object.entries(summary.rejected);
  if (rejected.length > 0) {
    lines.push("  skipped:");
    for (const [reason, count] of rejected) {
      lines.push(
        `    ${String(count).padStart(3)} × ${REJECTION_LABELS[reason as RejectionReason]}`,
      );
    }
  }
  if (summary.solidBlock) lines.push(`  solid block ${summary.solidBlock}`);
  return lines.join("\n");
}

/* -------------------------------------------------------------------------- */
/* Cursor                                                                      */
/* -------------------------------------------------------------------------- */

async function readCursor(config: TronConfig) {
  const db = getDb();
  const [row] = await db
    .select()
    .from(t.chainScanState)
    .where(
      and(
        eq(t.chainScanState.chain, "tron"),
        eq(t.chainScanState.network, config.network),
        eq(t.chainScanState.address, config.depositAddress),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function advanceCursor(
  config: TronConfig,
  highestTimestamp: number,
  solidBlock: bigint,
) {
  const db = getDb();
  const now = new Date();
  const lastTimestamp = highestTimestamp > 0 ? new Date(highestTimestamp) : null;

  await db
    .insert(t.chainScanState)
    .values({
      id: newId("scan", now),
      chain: "tron",
      network: config.network,
      address: config.depositAddress,
      lastBlockNumber: solidBlock,
      lastTimestamp,
      lastScanAt: now,
      lastSuccessAt: now,
      lastError: null,
      consecutiveFailures: 0,
    })
    .onConflictDoUpdate({
      target: [
        t.chainScanState.chain,
        t.chainScanState.network,
        t.chainScanState.address,
      ],
      set: {
        // `greatest` so a pass that saw nothing never rewinds the cursor.
        //
        // `timestampValue` rather than the `Date`: a value interpolated into a
        // `sql` fragment gets no column type mapper, and postgres.js cannot
        // serialise a bare Date. See `@/db/sql-values`.
        lastTimestamp: lastTimestamp
          ? sql`greatest(${t.chainScanState.lastTimestamp}, ${timestampValue(lastTimestamp)})`
          : t.chainScanState.lastTimestamp,
        lastBlockNumber: solidBlock,
        lastScanAt: now,
        lastSuccessAt: now,
        lastError: null,
        consecutiveFailures: 0,
        updatedAt: now,
      },
    });
}

/**
 * Records that a pass failed.
 *
 * A scanner that has been failing for a day should be visible in the database,
 * not merely absent from it — "no new deposits" and "no successful scan since
 * Tuesday" look identical from the deposits table alone.
 */
async function noteFailure(config: TronConfig, error: unknown, dryRun?: boolean) {
  if (dryRun || !isDatabaseConfigured()) return;

  const message =
    error instanceof TronGridError
      ? `${error.message}${error.retryable ? " (retryable)" : ""}`
      : error instanceof Error
        ? error.message
        : "unknown error";

  const now = new Date();
  try {
    await getDb()
      .insert(t.chainScanState)
      .values({
        id: newId("scan", now),
        chain: "tron",
        network: config.network,
        address: config.depositAddress,
        lastScanAt: now,
        lastError: message,
        consecutiveFailures: 1,
      })
      .onConflictDoUpdate({
        target: [
          t.chainScanState.chain,
          t.chainScanState.network,
          t.chainScanState.address,
        ],
        set: {
          lastScanAt: now,
          lastError: message,
          consecutiveFailures: sql`${t.chainScanState.consecutiveFailures} + 1`,
          updatedAt: now,
        },
      });
  } catch {
    // The original error is the one worth surfacing; failing to record the
    // failure must not replace it.
  }
}
