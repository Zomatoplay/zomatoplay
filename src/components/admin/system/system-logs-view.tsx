"use client";

import { useMemo, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, Clock } from "lucide-react";

import { AdminHeader } from "@/components/admin/layout/admin-header";
import { AdminPage, AdminSection } from "@/components/admin/layout/admin-shell";
import {
  AdminStatCard,
  AdminStatGrid,
} from "@/components/admin/shared/admin-stat-card";
import {
  DataCard,
  DataCardRow,
  DataTable,
  PrimaryCell,
  type DataTableColumn,
} from "@/components/admin/shared/data-table";
import {
  FilterBar,
  FilterChips,
  FilterSelect,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import { PermissionGate } from "@/components/admin/shared/permission-gate";
import { EmptyState } from "@/components/shared/empty-state";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import { useAdminStore } from "@/lib/admin-store";
import { cn } from "@/lib/utils";
import { CorrelationTrace } from "@/components/admin/system/correlation-trace";
import type {
  PipelineEvent,
  PipelineId,
  PipelineLayer,
  PipelineStatus,
} from "@/types/admin";
import { formatDateTimeUtc } from "@/utils/format";

/**
 * Integration and pipeline observability.
 *
 * WHAT THIS IS FOR, AND HOW IT DIFFERS FROM THE AUDIT LOG
 * -------------------------------------------------------
 * The audit log answers "who decided this?". This answers "what happened when
 * I clicked the button?" — the mechanical steps, their timings, their errors,
 * and a correlation id that ties one request's steps together. When a user
 * reports that a submission vanished, this is the screen that says whether the
 * write ran, how long it took, and what it threw.
 *
 * WHAT IS DELIBERATELY NOT HERE
 * -----------------------------
 * Passwords, session tokens, the Supabase service-role key, the TronGrid API
 * key, whole account numbers, document numbers. The recording helper takes
 * named non-sensitive fields only, and error text is passed through a redactor
 * before it is stored — a log an operator browses is not a place to spill a
 * connection string.
 */

type StatusFilter = "all" | PipelineStatus;
type PipelineFilter = "all" | PipelineId;
type LayerFilter = "all" | PipelineLayer;

const LAYER_LABELS: Record<PipelineLayer, string> = {
  client: "Client",
  server: "Server",
  database: "Database",
  external: "External API",
  blockchain: "Blockchain",
};

/**
 * Duration bands rather than a free number field.
 *
 * "Show me everything over a second" is the question an operator actually
 * asks; a min/max pair is two more inputs to fill in for the same answer.
 */
const DURATION_BANDS = [
  { value: "all", label: "Any duration", min: 0 },
  { value: "200", label: "≥ 200 ms", min: 200 },
  { value: "500", label: "≥ 500 ms", min: 500 },
  { value: "1000", label: "≥ 1 s", min: 1000 },
  { value: "3000", label: "≥ 3 s", min: 3000 },
] as const;

type DurationFilter = (typeof DURATION_BANDS)[number]["value"];

const TIME_WINDOWS = [
  { value: "all", label: "All time", minutes: Number.POSITIVE_INFINITY },
  { value: "15", label: "Last 15 min", minutes: 15 },
  { value: "60", label: "Last hour", minutes: 60 },
  { value: "1440", label: "Last 24 h", minutes: 1440 },
] as const;

type TimeFilter = (typeof TIME_WINDOWS)[number]["value"];

const PIPELINE_LABELS: Record<PipelineId, string> = {
  navigation: "Navigation",
  auth: "Authentication",
  kyc: "KYC",
  deposit: "Deposits",
  chain_scanner: "Chain scanner",
  investment: "Investments",
  withdrawal: "Withdrawals",
  email: "Email",
  database: "Database",
  admin: "Admin actions",
  support: "Support",
};

export function SystemLogsView() {
  return (
    <>
      <AdminHeader
        title="System logs"
        description="What the platform's integrations did, how long each step took, and what failed."
      />
      <AdminPage>
        <PermissionGate permission="audit_logs">
          <SystemLogsBrowser />
        </PermissionGate>
      </AdminPage>
    </>
  );
}

function SystemLogsBrowser() {
  const { pipelineEvents } = useAdminStore();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<StatusFilter>("all");
  const [pipeline, setPipeline] = useState<PipelineFilter>("all");
  const [layer, setLayer] = useState<LayerFilter>("all");
  const [duration, setDuration] = useState<DurationFilter>("all");
  const [window, setWindow] = useState<TimeFilter>("all");
  const [visible, setVisible] = useState(ADMIN_PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);
  /** The request being read end to end, if one has been opened. */
  const [tracing, setTracing] = useState<string | null>(null);

  const statusOptions: FilterOption<StatusFilter>[] = useMemo(() => {
    const count = (value: PipelineStatus) =>
      pipelineEvents.filter((event) => event.status === value).length;
    return [
      { value: "all", label: "All", count: pipelineEvents.length },
      { value: "failed", label: "Failed", count: count("failed") },
      { value: "ok", label: "Succeeded", count: count("ok") },
      // `started` with no matching completion is the shape of a hung step, so
      // it gets its own filter rather than being folded into "all".
      { value: "started", label: "Unfinished", count: count("started") },
    ];
  }, [pipelineEvents]);

  const minDuration =
    DURATION_BANDS.find((band) => band.value === duration)?.min ?? 0;
  const windowMinutes =
    TIME_WINDOWS.find((entry) => entry.value === window)?.minutes ??
    Number.POSITIVE_INFINITY;

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const cutoff =
      windowMinutes === Number.POSITIVE_INFINITY
        ? 0
        : Date.now() - windowMinutes * 60_000;

    return pipelineEvents.filter((event) => {
      if (status !== "all" && event.status !== status) return false;
      if (pipeline !== "all" && event.pipeline !== pipeline) return false;
      if (layer !== "all" && event.layer !== layer) return false;
      if (minDuration > 0 && (event.durationMs ?? 0) < minDuration) return false;
      if (cutoff && new Date(event.occurredAt).getTime() < cutoff) return false;
      if (!needle) return true;
      // One search box across every identifying field, so pasting a
      // correlation id, a route, an account or an operation name all work
      // without the operator choosing which kind of thing it is first.
      return [
        event.operation,
        event.message,
        event.errorMessage,
        event.correlationId,
        event.route,
        event.userLabel,
        event.actorName,
        event.subjectId,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [pipelineEvents, query, status, pipeline, layer, minDuration, windowMinutes]);

  /** Every event sharing the opened request's id — not just the visible page. */
  const tracedEvents = useMemo(
    () =>
      tracing
        ? pipelineEvents.filter((event) => event.correlationId === tracing)
        : [],
    [pipelineEvents, tracing],
  );

  const failures = pipelineEvents.filter((event) => event.status === "failed");
  const timed = pipelineEvents.filter((event) => event.durationMs !== null);
  const slowest = timed.reduce<PipelineEvent | null>(
    (worst, event) =>
      !worst || (event.durationMs ?? 0) > (worst.durationMs ?? 0) ? event : worst,
    null,
  );

  const columns: DataTableColumn<PipelineEvent>[] = [
    {
      id: "when",
      header: "When",
      cell: (event) => (
        <div className="flex min-w-0 flex-col">
          <span className="tabular truncate font-medium text-foreground">
            {formatDateTimeUtc(event.occurredAt)}
          </span>
          <button
            type="button"
            onClick={() => setTracing(event.correlationId)}
            title="Show the complete execution trace for this request"
            className="truncate text-left font-mono text-xs text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            {event.correlationId}
          </button>
        </div>
      ),
    },
    {
      id: "pipeline",
      header: "Pipeline",
      cell: (event) => (
        <div className="flex flex-col gap-1">
          <Badge variant="outline">{PIPELINE_LABELS[event.pipeline]}</Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {event.operation}
          </span>
        </div>
      ),
    },
    {
      id: "layer",
      header: "Layer",
      cell: (event) => (
        <Badge variant="outline">{LAYER_LABELS[event.layer]}</Badge>
      ),
    },
    {
      id: "status",
      header: "Status",
      cell: (event) => <StatusPill status={event.status} />,
    },
    {
      id: "duration",
      header: "Duration",
      numeric: true,
      cell: (event) => (
        <span
          className={cn(
            "tabular text-sm",
            (event.durationMs ?? 0) >= 1000 ? "font-medium text-warning" : undefined,
          )}
        >
          {event.durationMs === null ? "—" : `${event.durationMs} ms`}
        </span>
      ),
    },
    {
      id: "subject",
      header: "Account / subject",
      cell: (event) => (
        <PrimaryCell
          title={event.userLabel ?? event.actorName ?? "—"}
          subtitle={
            event.route ??
            (event.subjectId
              ? `${event.subjectType}: ${event.subjectId}`
              : undefined)
          }
        />
      ),
    },
    {
      id: "message",
      header: "Detail",
      cell: (event) => (
        <div className="min-w-0 max-w-md">
          <p className="text-sm leading-snug text-foreground">{event.message}</p>
          {event.errorMessage ? (
            <p className="mt-1 break-words font-mono text-xs leading-snug text-destructive">
              {event.errorMessage}
            </p>
          ) : null}
          {event.metadata && Object.keys(event.metadata).length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setExpanded(expanded === event.id ? null : event.id)
              }
              className="mt-1 text-xs font-medium text-brand underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {expanded === event.id ? "Hide details" : "Show details"}
            </button>
          ) : null}
          {expanded === event.id && event.metadata ? (
            <dl className="mt-2 space-y-0.5 rounded-lg bg-secondary/60 p-2">
              {Object.entries(event.metadata).map(([key, value]) => (
                <div key={key} className="flex gap-2 text-xs">
                  <dt className="shrink-0 text-muted-foreground">{key}</dt>
                  <dd className="tabular min-w-0 break-words font-mono text-foreground">
                    {String(value)}
                  </dd>
                </div>
              ))}
            </dl>
          ) : null}
        </div>
      ),
    },
  ];

  return (
    <AdminSection
      title="Recent activity"
      description="The most recent 500 events, newest first."
    >
      <AdminStatGrid>
        <AdminStatCard label="Events recorded" value={String(pipelineEvents.length)} />
        <AdminStatCard
          label="Failures"
          value={String(failures.length)}
          tone={failures.length > 0 ? "negative" : "default"}
        />
        <AdminStatCard
          label="Slowest step"
          value={slowest?.durationMs ? `${slowest.durationMs} ms` : "—"}
          hint={slowest?.operation}
        />
      </AdminStatGrid>

      <FilterBar>
        <SearchField
          value={query}
          onChange={setQuery}
          label="Search system logs"
          placeholder="Operation, message, correlation ID, account"
        />
        <FilterSelect
          label="Pipeline"
          value={pipeline}
          onChange={(value) => setPipeline(value as PipelineFilter)}
          options={[
            { value: "all", label: "All pipelines" },
            ...(Object.keys(PIPELINE_LABELS) as PipelineId[]).map((id) => ({
              value: id,
              label: PIPELINE_LABELS[id],
            })),
          ]}
        />
        <FilterSelect
          label="Layer"
          value={layer}
          onChange={(value) => setLayer(value as LayerFilter)}
          options={[
            { value: "all", label: "All layers" },
            ...(Object.keys(LAYER_LABELS) as PipelineLayer[]).map((id) => ({
              value: id,
              label: LAYER_LABELS[id],
            })),
          ]}
        />
        <FilterSelect
          label="Slower than"
          value={duration}
          onChange={(value) => setDuration(value as DurationFilter)}
          options={DURATION_BANDS.map((band) => ({
            value: band.value,
            label: band.label,
          }))}
        />
        <FilterSelect
          label="When"
          value={window}
          onChange={(value) => setWindow(value as TimeFilter)}
          options={TIME_WINDOWS.map((entry) => ({
            value: entry.value,
            label: entry.label,
          }))}
        />
        <FilterChips
          options={statusOptions}
          value={status}
          onChange={setStatus}
          label="Filter by outcome"
        />
      </FilterBar>

      {tracing ? (
        <CorrelationTrace
          correlationId={tracing}
          events={tracedEvents}
          onClose={() => setTracing(null)}
        />
      ) : null}

      {filtered.length === 0 ? (
        <EmptyState
          icon={Activity}
          title={
            pipelineEvents.length === 0
              ? "Nothing recorded yet"
              : "No events match those filters"
          }
          description={
            pipelineEvents.length === 0
              ? "Sign in, submit a verification or run the deposit scanner, and the steps will appear here."
              : "Widen the search or clear a filter."
          }
        />
      ) : (
        <>
          <DataTable
            caption="System and integration events"
            columns={columns}
            rows={filtered.slice(0, visible)}
            getRowKey={(event) => event.id}
            empty={null}
            resetKey={`${query}|${status}|${pipeline}|${layer}|${duration}|${window}`}
            renderCard={(event) => (
              <DataCard>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium">
                      {event.operation}
                    </p>
                    <p className="tabular mt-0.5 text-xs text-muted-foreground">
                      {formatDateTimeUtc(event.occurredAt)}
                    </p>
                  </div>
                  <StatusPill status={event.status} />
                </div>
                <DataCardRow label="Pipeline">
                  {PIPELINE_LABELS[event.pipeline]}
                </DataCardRow>
                <DataCardRow label="Duration">
                  {event.durationMs === null ? "—" : `${event.durationMs} ms`}
                </DataCardRow>
                <DataCardRow label="Account">
                  {event.userLabel ?? event.actorName ?? "—"}
                </DataCardRow>
                <DataCardRow label="Correlation">
                  <button
                    type="button"
                    onClick={() => setTracing(event.correlationId)}
                    className="break-all text-left font-mono text-xs text-brand underline-offset-4 hover:underline"
                  >
                    {event.correlationId}
                  </button>
                </DataCardRow>
                <DataCardRow label="Layer">
                  {LAYER_LABELS[event.layer]}
                </DataCardRow>
                <DataCardRow label="Detail">{event.message}</DataCardRow>
                {event.errorMessage ? (
                  <DataCardRow label="Error">
                    <span className="break-words font-mono text-xs text-destructive">
                      {event.errorMessage}
                    </span>
                  </DataCardRow>
                ) : null}
              </DataCard>
            )}
          />

          {filtered.length > visible ? (
            <Button
              variant="outline"
              block
              onClick={() => setVisible(visible + ADMIN_PAGE_SIZE)}
            >
              Show more ({filtered.length - visible} remaining)
            </Button>
          ) : null}
        </>
      )}
    </AdminSection>
  );
}

/** Outcome is carried by an icon and a word, never by colour alone. */
function StatusPill({ status }: { status: PipelineStatus }) {
  if (status === "failed") {
    return (
      <Badge variant="negative">
        <AlertTriangle className="size-3" aria-hidden />
        Failed
      </Badge>
    );
  }
  if (status === "started") {
    return (
      <Badge variant="outline">
        <Clock className="size-3" aria-hidden />
        Unfinished
      </Badge>
    );
  }
  return (
    <Badge variant="brand">
      <CheckCircle2 className="size-3" aria-hidden />
      OK
    </Badge>
  );
}
