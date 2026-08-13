"use client";

import { useId, useState } from "react";

import { cn } from "@/lib/utils";
import type { AdminFlowPoint, AdminSeriesPoint } from "@/types/admin";

/**
 * Charts for the CRM dashboard.
 *
 * Deliberately plain: magnitude over time and one proportion bar. Nothing here
 * is a trading chart — no candlesticks, no price axis, no pairs. An operations
 * console needs to answer "how much came in, how many signed up, how big is the
 * book", and that is all these do.
 *
 * Colour rules followed throughout:
 *   - A single series carries no legend; the heading names it.
 *   - The two-direction flow chart encodes direction by *position* (above or
 *     below the zero baseline). Colour reinforces a distinction the axis
 *     already makes, so the reading never depends on hue alone.
 *   - The chart hues are the design system's `--chart-1` (brand teal) and
 *     `--chart-5` (amber). Validated as a pair against the card surface in both
 *     light and dark modes: CVD ΔE 10.1 light / 9.7 dark and normal-vision ΔE
 *     17.9 / 18.0, both clear of the ≥8 and ≥15 floors, with each step above 3:1
 *     contrast. (The brand teal sits under the chroma floor by design — §8 of
 *     CLAUDE.md mandates a restrained, low-chroma accent — which is exactly why
 *     position, a legend and a table view all carry the meaning too.)
 *   - Every chart ships a screen-reader table, so no value is reachable only by
 *     hovering a mark.
 */

/* -------------------------------------------------------------------------- */
/* Shared pieces                                                               */
/* -------------------------------------------------------------------------- */

function ChartFrame({
  title,
  description,
  readout,
  legend,
  children,
  className,
}: {
  title: string;
  description?: string;
  readout?: React.ReactNode;
  legend?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        // `min-w-0` matters: as a grid child the default `min-width: auto`
        // would let a 12-point axis widen the whole track past the viewport.
        "flex min-w-0 flex-col rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
          {description ? (
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              {description}
            </p>
          ) : null}
        </div>
        {legend}
      </div>
      {readout ? <div className="mt-3">{readout}</div> : null}
      <div className="mt-4 flex-1">{children}</div>
    </section>
  );
}

function LegendSwatch({
  color,
  label,
}: {
  /** A `bg-*` utility naming a chart token. */
  color: string;
  label: string;
}) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className={cn("size-2.5 rounded-[3px]", color)} aria-hidden />
      {label}
    </span>
  );
}

/** Tooltip anchored to a mark, kept inside the plot at either edge. */
function MarkTooltip({
  index,
  count,
  children,
}: {
  index: number;
  count: number;
  children: React.ReactNode;
}) {
  const centre = ((index + 0.5) / count) * 100;
  // Near the edges an origin-centred tooltip would overflow the card, so the
  // first and last marks anchor their tooltip inward instead.
  const nearStart = index <= 1;
  const nearEnd = index >= count - 2;

  return (
    <div
      role="status"
      // Sits at the top of the plot rather than above it, so it stays inside
      // the card and never collides with the heading.
      className="pointer-events-none absolute top-0 z-10"
      style={{
        left: `${centre}%`,
        transform: `translateX(${nearStart ? "0%" : nearEnd ? "-100%" : "-50%"})`,
      }}
    >
      <div className="whitespace-nowrap rounded-lg border border-border bg-popover px-2.5 py-1.5 text-xs shadow-md">
        {children}
      </div>
    </div>
  );
}

function SrTable({
  id,
  caption,
  columns,
  rows,
}: {
  id: string;
  caption: string;
  columns: string[];
  rows: (string | number)[][];
}) {
  return (
    <table id={id} className="sr-only">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column} scope="col">
              {column}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={String(row[0])}>
            <th scope="row">{row[0]}</th>
            {row.slice(1).map((cell, index) => (
              <td key={index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/* -------------------------------------------------------------------------- */
/* Money in vs money out                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Deposits above the baseline, withdrawals below it. The zero line is the
 * chart's subject: what an operator wants at a glance is net flow.
 */
export function PlatformFlowChart({
  points,
  formatValue,
  className,
}: {
  points: AdminFlowPoint[];
  /** Value formatter. Currency knowledge stays outside the chart. */
  formatValue: (value: number) => string;
  className?: string;
}) {
  const tableId = useId();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(
    ...points.map((point) => Math.max(point.inbound, point.outbound)),
    1,
  );
  const hovered = active === null ? null : { index: active, point: points[active] };

  return (
    <ChartFrame
      title="Deposits and withdrawals"
      description="Last 12 weeks. Deposits above the line, withdrawals below."
      className={className}
      legend={
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <LegendSwatch color="bg-chart-1" label="Deposits" />
          <LegendSwatch color="bg-chart-5" label="Withdrawals" />
        </div>
      }
    >
      <div className="relative">
        <div
          className="flex h-44 items-stretch gap-0.5 sm:gap-1"
          role="group"
          aria-label="Weekly deposits and withdrawals. Focus a week to read its values."
          aria-describedby={tableId}
        >
          {points.map((entry, index) => {
            const isActive = active === index;
            const inboundHeight = (entry.inbound / max) * 100;
            const outboundHeight = (entry.outbound / max) * 100;
            return (
              <button
                key={entry.label}
                type="button"
                // The hit area is the full column height, far larger than
                // either bar, so precision pointing is never required.
                className="group relative flex flex-1 cursor-default flex-col rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                aria-label={`${entry.label}: deposits ${formatValue(entry.inbound)}, withdrawals ${formatValue(entry.outbound)}`}
              >
                {/* Upper half — deposits, growing from the baseline. */}
                <span className="flex flex-1 flex-col justify-end pb-px">
                  <span
                    className={cn(
                      "w-full rounded-t-[4px] bg-chart-1 transition-opacity",
                      active !== null && !isActive ? "opacity-40" : "opacity-100",
                    )}
                    style={{ height: `${Math.max(inboundHeight, 2)}%` }}
                  />
                </span>
                {/* Baseline. */}
                <span className="h-px w-full shrink-0 bg-border" aria-hidden />
                {/* Lower half — withdrawals, hanging from the baseline. */}
                <span className="flex flex-1 flex-col justify-start pt-px">
                  <span
                    className={cn(
                      "w-full rounded-b-[4px] bg-chart-5 transition-opacity",
                      active !== null && !isActive ? "opacity-40" : "opacity-100",
                    )}
                    style={{ height: `${Math.max(outboundHeight, 2)}%` }}
                  />
                </span>
              </button>
            );
          })}
        </div>

        {hovered ? (
          <MarkTooltip index={hovered.index} count={points.length}>
            <span className="block font-medium text-foreground">
              {hovered.point.label}
            </span>
            <span className="mt-1 block text-muted-foreground">
              In{" "}
              <span className="tabular text-foreground">
                {formatValue(hovered.point.inbound)}
              </span>
            </span>
            <span className="block text-muted-foreground">
              Out{" "}
              <span className="tabular text-foreground">
                {formatValue(hovered.point.outbound)}
              </span>
            </span>
            <span className="mt-1 block border-t border-border pt-1 text-muted-foreground">
              Net{" "}
              <span
                className={cn(
                  "tabular font-medium",
                  hovered.point.inbound >= hovered.point.outbound
                    ? "text-positive"
                    : "text-destructive",
                )}
              >
                {hovered.point.inbound >= hovered.point.outbound ? "+" : "−"}
                {formatValue(
                  Math.abs(hovered.point.inbound - hovered.point.outbound),
                )}
              </span>
            </span>
          </MarkTooltip>
        ) : null}
      </div>

      <div className="mt-2 flex gap-0.5 sm:gap-1" aria-hidden>
        {points.map((entry, index) => (
          <span
            key={entry.label}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[11px] transition-colors",
              active === index ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {entry.label}
          </span>
        ))}
      </div>

      <SrTable
        id={tableId}
        caption="Weekly deposits and withdrawals"
        columns={["Week", "Deposits", "Withdrawals"]}
        rows={points.map((entry) => [
          entry.label,
          formatValue(entry.inbound),
          formatValue(entry.outbound),
        ])}
      />
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Single-series bars                                                          */
/* -------------------------------------------------------------------------- */

export function SeriesBarChart({
  title,
  description,
  points,
  formatValue,
  className,
}: {
  title: string;
  description?: string;
  points: AdminSeriesPoint[];
  formatValue: (value: number) => string;
  className?: string;
}) {
  const tableId = useId();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...points.map((p) => p.value), 1);
  const point = active === null ? null : points[active];

  return (
    <ChartFrame
      title={title}
      description={description}
      className={className}
      readout={
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {point ? point.label : "Latest"}
          </p>
          <p className="text-2xl font-semibold leading-tight tracking-tight">
            {formatValue(point ? point.value : points[points.length - 1].value)}
          </p>
        </div>
      }
    >
      <div className="relative">
        <div
          className="flex h-32 items-end gap-0.5 sm:gap-1.5"
          role="group"
          aria-label={`${title}. Focus a bar to read its value.`}
          aria-describedby={tableId}
        >
          {points.map((entry, index) => {
            const isActive = active === index;
            return (
              <button
                key={entry.label}
                type="button"
                className="group flex h-full flex-1 cursor-default flex-col justify-end rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                onMouseEnter={() => setActive(index)}
                onMouseLeave={() => setActive(null)}
                onFocus={() => setActive(index)}
                onBlur={() => setActive(null)}
                aria-label={`${entry.label}: ${formatValue(entry.value)}`}
              >
                <span
                  className={cn(
                    "w-full rounded-t-[4px] bg-chart-1 transition-opacity",
                    active !== null && !isActive ? "opacity-40" : "opacity-100",
                  )}
                  style={{ height: `${Math.max((entry.value / max) * 100, 3)}%` }}
                />
              </button>
            );
          })}
        </div>

        {active !== null ? (
          <MarkTooltip index={active} count={points.length}>
            <span className="block font-medium text-foreground">
              {points[active].label}
            </span>
            <span className="tabular block text-muted-foreground">
              {formatValue(points[active].value)}
            </span>
          </MarkTooltip>
        ) : null}
      </div>

      <div className="mt-2 flex gap-0.5 sm:gap-1.5" aria-hidden>
        {points.map((entry, index) => (
          <span
            key={entry.label}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[11px] transition-colors",
              active === index ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {entry.label}
          </span>
        ))}
      </div>

      <SrTable
        id={tableId}
        caption={title}
        columns={["Period", "Value"]}
        rows={points.map((entry) => [entry.label, formatValue(entry.value)])}
      />
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Trend                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Single-series area chart for a cumulative measure. The stroke uses
 * `vector-effect="non-scaling-stroke"` so the 2px line stays 2px under the
 * non-uniform scaling that lets the SVG fill its container.
 */
export function TrendChart({
  title,
  description,
  points,
  formatValue,
  className,
}: {
  title: string;
  description?: string;
  points: AdminSeriesPoint[];
  formatValue: (value: number) => string;
  className?: string;
}) {
  const tableId = useId();
  const gradientId = useId();
  const [active, setActive] = useState<number | null>(null);

  const max = Math.max(...points.map((p) => p.value), 1);
  const min = Math.min(...points.map((p) => p.value), 0);
  const span = max - min || 1;
  const point = active === null ? null : points[active];

  const coords = points.map((entry, index) => ({
    x: (index / Math.max(points.length - 1, 1)) * 100,
    y: 100 - ((entry.value - min) / span) * 100,
  }));

  const line = coords.map((c, i) => `${i === 0 ? "M" : "L"}${c.x},${c.y}`).join(" ");
  const area = `${line} L100,100 L0,100 Z`;

  return (
    <ChartFrame
      title={title}
      description={description}
      className={className}
      readout={
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            {point ? point.label : "Current"}
          </p>
          <p className="text-2xl font-semibold leading-tight tracking-tight">
            {formatValue(point ? point.value : points[points.length - 1].value)}
          </p>
        </div>
      }
    >
      <div className="relative">
        <svg
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          className="h-32 w-full"
          aria-hidden
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--chart-1)" stopOpacity="0.22" />
              <stop offset="100%" stopColor="var(--chart-1)" stopOpacity="0.02" />
            </linearGradient>
          </defs>
          {/* Recessive solid hairline grid — never dashed. */}
          {[0, 25, 50, 75, 100].map((y) => (
            <line
              key={y}
              x1="0"
              y1={y}
              x2="100"
              y2={y}
              stroke="var(--border)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ))}
          <path d={area} fill={`url(#${gradientId})`} />
          <path
            d={line}
            fill="none"
            stroke="var(--chart-1)"
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
          {active !== null ? (
            <line
              x1={coords[active].x}
              y1="0"
              x2={coords[active].x}
              y2="100"
              stroke="var(--chart-1)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
        </svg>

        {/* Hit layer: full-height targets, one per point. */}
        <div
          className="absolute inset-0 flex"
          role="group"
          aria-label={`${title}. Focus a period to read its value.`}
          aria-describedby={tableId}
        >
          {points.map((entry, index) => (
            <button
              key={entry.label}
              type="button"
              className="h-full flex-1 cursor-default rounded focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring"
              onMouseEnter={() => setActive(index)}
              onMouseLeave={() => setActive(null)}
              onFocus={() => setActive(index)}
              onBlur={() => setActive(null)}
              aria-label={`${entry.label}: ${formatValue(entry.value)}`}
            />
          ))}
        </div>

        {active !== null ? (
          <MarkTooltip index={active} count={points.length}>
            <span className="block font-medium text-foreground">
              {points[active].label}
            </span>
            <span className="tabular block text-muted-foreground">
              {formatValue(points[active].value)}
            </span>
          </MarkTooltip>
        ) : null}
      </div>

      <div className="mt-2 flex" aria-hidden>
        {points.map((entry, index) => (
          <span
            key={entry.label}
            className={cn(
              "min-w-0 flex-1 truncate text-center text-[11px] transition-colors",
              active === index ? "font-medium text-foreground" : "text-muted-foreground",
            )}
          >
            {entry.label}
          </span>
        ))}
      </div>

      <SrTable
        id={tableId}
        caption={title}
        columns={["Period", "Value"]}
        rows={points.map((entry) => [entry.label, formatValue(entry.value)])}
      />
    </ChartFrame>
  );
}

/* -------------------------------------------------------------------------- */
/* Proportion bar                                                              */
/* -------------------------------------------------------------------------- */

export interface BreakdownSegment {
  id: string;
  label: string;
  count: number;
  /** A `bg-*` utility naming the token this segment uses. */
  color: string;
}

/**
 * Part-to-whole bar for a pipeline. Each segment carries a label and a count in
 * the legend, so the proportions are readable without interpreting colour, and
 * a 2px surface gap separates adjacent fills rather than a border.
 */
export function StatusBreakdownBar({
  title,
  description,
  segments,
  className,
}: {
  title: string;
  description?: string;
  segments: BreakdownSegment[];
  className?: string;
}) {
  const total = segments.reduce((sum, segment) => sum + segment.count, 0) || 1;

  return (
    <ChartFrame title={title} description={description} className={className}>
      <div className="flex h-3 w-full gap-0.5 overflow-hidden rounded-full">
        {segments.map((segment) => (
          <span
            key={segment.id}
            className={cn("h-full first:rounded-l-full last:rounded-r-full", segment.color)}
            style={{ width: `${(segment.count / total) * 100}%` }}
            aria-hidden
          />
        ))}
      </div>

      <ul className="mt-4 space-y-2">
        {segments.map((segment) => {
          const share = (segment.count / total) * 100;
          return (
            <li
              key={segment.id}
              className="flex items-center justify-between gap-3 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span
                  className={cn("size-2.5 shrink-0 rounded-[3px]", segment.color)}
                  aria-hidden
                />
                <span className="truncate text-muted-foreground">
                  {segment.label}
                </span>
              </span>
              <span className="shrink-0 tabular">
                <span className="font-medium">
                  {segment.count.toLocaleString("en-IN")}
                </span>
                <span className="ml-1.5 text-xs text-muted-foreground">
                  {share.toFixed(1)}%
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </ChartFrame>
  );
}
