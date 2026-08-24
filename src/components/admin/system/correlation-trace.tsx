"use client";

import { X } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PipelineEvent, PipelineLayer } from "@/types/admin";

/**
 * One request, start to finish.
 *
 * This is the screen's reason for existing. A list of events sorted by time
 * tells you the system is busy; this tells you where a single click spent its
 * time, which is the only view that answers "why was that slow".
 *
 * Read as a waterfall: each row is offset by when it started relative to the
 * first event, and its bar is as wide as it took. A single long bar is a slow
 * operation; a staircase of short bars is a sequential chain that could have
 * been parallel; a gap is time nothing accounted for.
 */

const LAYER_STYLE: Record<PipelineLayer, string> = {
  client: "bg-chart-5",
  server: "bg-brand",
  database: "bg-chart-1",
  external: "bg-warning",
  blockchain: "bg-info",
};

const LAYER_LABEL: Record<PipelineLayer, string> = {
  client: "CLIENT",
  server: "SERVER",
  database: "DATABASE",
  external: "EXTERNAL",
  blockchain: "BLOCKCHAIN",
};

export function CorrelationTrace({
  correlationId,
  events,
  onClose,
}: {
  correlationId: string;
  /** Every event carrying this id. Order does not matter; sorted here. */
  events: PipelineEvent[];
  onClose: () => void;
}) {
  const ordered = [...events].sort(
    (a, b) =>
      new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
  );

  if (ordered.length === 0) return null;

  const firstAt = new Date(ordered[0].occurredAt).getTime();
  const lastAt = new Date(ordered[ordered.length - 1].occurredAt).getTime();
  const lastDuration = ordered[ordered.length - 1].durationMs ?? 0;

  /**
   * Wall-clock span, not the sum of the parts.
   *
   * Adding the durations would double-count everything nested — a server action
   * contains the queries it made — and produce a total larger than the request
   * ever took.
   */
  const totalMs = Math.max(lastAt + lastDuration - firstAt, lastDuration, 1);

  const slowest = ordered.reduce(
    (worst, event) =>
      (event.durationMs ?? 0) > (worst?.durationMs ?? 0) ? event : worst,
    ordered[0],
  );

  return (
    <section
      aria-label={`Execution trace for ${correlationId}`}
      className="space-y-3 rounded-2xl border border-border bg-card p-4"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold">Execution trace</h3>
          <p className="mt-0.5 break-all font-mono text-xs text-muted-foreground">
            {correlationId}
          </p>
        </div>
        <Button variant="ghost" size="sm" onClick={onClose}>
          <X className="size-4" aria-hidden />
          Close
        </Button>
      </div>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs">
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="tabular font-semibold">{Math.round(totalMs)} ms</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="text-muted-foreground">Steps</dt>
          <dd className="tabular font-medium">{ordered.length}</dd>
        </div>
        <div className="flex min-w-0 gap-1.5">
          <dt className="text-muted-foreground">Slowest</dt>
          <dd className="min-w-0 truncate font-mono font-medium">
            {slowest.operation} · {slowest.durationMs ?? 0} ms
          </dd>
        </div>
        {ordered[0].route ? (
          <div className="flex min-w-0 gap-1.5">
            <dt className="text-muted-foreground">Route</dt>
            <dd className="truncate font-mono font-medium">{ordered[0].route}</dd>
          </div>
        ) : null}
      </dl>

      <ol className="space-y-1.5">
        {ordered.map((event) => {
          const startedAt = new Date(event.occurredAt).getTime();
          const duration = event.durationMs ?? 0;
          // A step is recorded when it *finishes*, so its bar starts one
          // duration earlier — otherwise every bar would hang off the right.
          const offset = Math.max(startedAt - duration - firstAt, 0);
          const offsetPercent = (offset / totalMs) * 100;
          const widthPercent = Math.max((duration / totalMs) * 100, 0.6);

          return (
            <li key={event.id} className="space-y-1">
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs">
                <Badge variant="outline" className="shrink-0">
                  {LAYER_LABEL[event.layer]}
                </Badge>
                <span className="min-w-0 flex-1 truncate font-mono font-medium text-foreground">
                  {event.operation}
                </span>
                <span
                  className={cn(
                    "tabular shrink-0 font-medium",
                    duration >= 500 ? "text-warning" : "text-muted-foreground",
                  )}
                >
                  {event.durationMs === null ? "—" : `${duration} ms`}
                </span>
                {event.status === "failed" ? (
                  <Badge variant="negative" className="shrink-0">
                    failed
                  </Badge>
                ) : null}
              </div>

              {/* The waterfall. Purely supporting: every figure above is text. */}
              <div
                className="h-1.5 w-full overflow-hidden rounded-full bg-secondary"
                aria-hidden
              >
                <div
                  className={cn("h-full rounded-full", LAYER_STYLE[event.layer])}
                  style={{
                    marginLeft: `${Math.min(offsetPercent, 99)}%`,
                    width: `${Math.min(widthPercent, 100 - Math.min(offsetPercent, 99))}%`,
                  }}
                />
              </div>

              {event.errorMessage ? (
                <p className="break-words font-mono text-[11px] leading-snug text-destructive">
                  {event.errorMessage}
                </p>
              ) : null}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
