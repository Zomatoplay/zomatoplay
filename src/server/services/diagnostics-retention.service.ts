import "server-only";

import { getDb, isDatabaseConfigured } from "@/db";

import { deleteOldPipelineEvents } from "../repositories/pipeline.repository";
import { recordPipelineEvent, trackPipeline } from "../observability";

/**
 * Keeping the diagnostics table from growing without end.
 *
 * WHY THIS IS NEEDED, MEASURED
 * ----------------------------
 * `pipeline_events` was the **largest table in the database** at 28,464 rows
 * and 10 MB — larger than every business table combined (`users` 256 kB,
 * `transactions` 248 kB, `audit_logs` 192 kB) — from one developer and a
 * handful of test runs. Nothing pruned it. Each page view writes several rows,
 * so it grows with traffic rather than with the business, and it grew again
 * when error recording began keeping whole cause chains.
 *
 * The failure mode is not storage cost, which is trivial. It is that the one
 * screen that exists to diagnose an incident gets slower exactly as the
 * incident is happening, and that the table's indexes — eight of them — grow
 * with it.
 *
 * WHY `audit_logs` IS NOT TOUCHED, AND MUST NOT BE
 * ------------------------------------------------
 * The two tables answer different questions and have different lifetimes
 * (CLAUDE.md §22). `audit_logs` records *who decided what* — it is evidence,
 * somebody may have to answer for it, and it is append-only and kept.
 * `pipeline_events` records *what the machinery did* — diagnostics, explicitly
 * prunable, and the schema already says so. Nothing here may ever be pointed
 * at the audit trail.
 */

/** How long a diagnostic row is kept. 30 days by default. */
const RETENTION_DAYS = Number(process.env.PIPELINE_EVENT_RETENTION_DAYS ?? 30);

/** Rows per transaction. Small enough that no single delete holds a connection long. */
const BATCH_SIZE = Number(process.env.PIPELINE_EVENT_PRUNE_BATCH ?? 2_000);

/**
 * Batches per run.
 *
 * A ceiling rather than "delete everything": the first prune of a table that
 * has never been pruned could be millions of rows, and a scheduled job that
 * runs for an unbounded time on a serverless platform is a job that gets
 * killed halfway. Ten batches is 20,000 rows, comfortably more than a day
 * produces, so a healthy deployment always finishes — and a backlog drains
 * over consecutive runs instead of in one long stall.
 */
const MAX_BATCHES = Number(process.env.PIPELINE_EVENT_PRUNE_BATCHES ?? 10);

export interface PruneSummary {
  deleted: number;
  /** True when the ceiling was reached and there is more to remove next run. */
  more: boolean;
  cutoff: string;
  retentionDays: number;
}

/**
 * The batching loop, separated from the database so it can be tested.
 *
 * Exported for the tests rather than for callers: the stop conditions are the
 * part worth pinning — stop early when a batch comes back short, stop at the
 * ceiling and say so — and neither needs Postgres to be exercised. `deleteBatch`
 * returns how many rows it removed.
 */
export async function runPrune(
  deleteBatch: () => Promise<number>,
  limits: { batchSize: number; maxBatches: number },
): Promise<{ deleted: number; more: boolean }> {
  let deleted = 0;

  for (let batch = 0; batch < limits.maxBatches; batch++) {
    const removed = await deleteBatch();
    deleted += removed;
    // A short batch means the window is clear; stop rather than issue a
    // statement that will match nothing.
    if (removed < limits.batchSize) return { deleted, more: false };
  }

  return { deleted, more: true };
}

export async function prunePipelineEvents(
  options: { now?: Date } = {},
): Promise<PruneSummary> {
  const now = options.now ?? new Date();
  const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60_000);

  const summary: PruneSummary = {
    deleted: 0,
    more: false,
    cutoff: cutoff.toISOString(),
    retentionDays: RETENTION_DAYS,
  };

  // `RETENTION_DAYS <= 0` is the off switch: a deployment that wants to keep
  // everything sets it to 0 rather than editing code, and gets a no-op run
  // instead of a delete with a cutoff in the future.
  if (!isDatabaseConfigured() || RETENTION_DAYS <= 0) return summary;

  return trackPipeline(
    {
      pipeline: "database",
      operation: "diagnostics.prune",
      message: "Pruning pipeline_events past its retention window",
      metadata: { retentionDays: RETENTION_DAYS },
    },
    async () => {
      const db = getDb();
      const { deleted, more } = await runPrune(
        () => deleteOldPipelineEvents(db, cutoff, BATCH_SIZE),
        { batchSize: BATCH_SIZE, maxBatches: MAX_BATCHES },
      );

      summary.deleted = deleted;
      summary.more = more;

      if (more) {
        /*
         * Said out loud, because a prune that never catches up is a prune that
         * is not working and would otherwise look identical to one that is. A
         * deployment hitting this every run needs a shorter retention or a
         * bigger ceiling, and this row is how anybody finds out.
         */
        recordPipelineEvent({
          pipeline: "database",
          operation: "diagnostics.prune.incomplete",
          status: "ok",
          message:
            `Pruned ${deleted} diagnostic rows and stopped at the per-run ` +
            `ceiling; more remain older than the retention window.`,
          metadata: { deleted, retentionDays: RETENTION_DAYS },
        });
      }

      return summary;
    },
  );
}
