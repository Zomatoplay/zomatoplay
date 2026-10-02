"use client";

import { useId, useState } from "react";

import { formatUsdt } from "@/lib/currency";
import { cn } from "@/lib/utils";
import type { EarningsPoint } from "@/types";

interface EarningsChartProps {
  points: EarningsPoint[];
  /** Readout shown when no bar is selected. */
  totalLabel: string;
  total: number;
  className?: string;
}

/**
 * Single-series magnitude-over-time chart.
 *
 * One measure, one hue — so there is no legend (the heading names the series)
 * and no categorical palette to validate. Instead of a floating tooltip, which
 * is awkward to place inside a 360px viewport, each bar is a button that
 * promotes its own value into the readout above. That keeps the interaction
 * touch-friendly and keyboard-navigable, and guarantees nothing overflows.
 *
 * An equivalent data table is rendered for screen readers so the values are
 * never conveyed by bar height alone.
 */
export function EarningsChart({
  points,
  totalLabel,
  total,
  className,
}: EarningsChartProps) {
  const [selected, setSelected] = useState<number | null>(null);
  const tableId = useId();

  const max = Math.max(...points.map((point) => point.value), 0);
  const active = selected === null ? null : points[selected];

  const readoutValue = active ? active.value : total;
  const readoutLabel = active ? active.label : totalLabel;

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted-foreground">{readoutLabel}</p>
          <p className="tabular text-2xl font-semibold tracking-tight text-foreground">
            {formatUsdt(readoutValue)}
          </p>
        </div>
        {active ? (
          <button
            type="button"
            onClick={() => setSelected(null)}
            className="shrink-0 rounded-full px-2 py-1 text-xs font-medium text-brand transition-colors hover:bg-brand-soft focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Reset
          </button>
        ) : null}
      </div>

      {/* Bars. `gap-` provides the 2px surface separation between marks. */}
      <div
        className="flex h-28 items-end gap-1.5"
        role="group"
        aria-label="Earnings by period. Select a bar to see its value."
        aria-describedby={tableId}
      >
        {points.map((point, index) => {
          const heightPercent = max > 0 ? Math.max((point.value / max) * 100, 6) : 6;
          const isActive = selected === index;
          return (
            <button
              key={point.label}
              type="button"
              onClick={() => setSelected(isActive ? null : index)}
              // Full-height hit area: the tap target is far larger than the bar.
              className="group flex h-full flex-1 cursor-pointer flex-col justify-end rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
              aria-pressed={isActive}
              aria-label={`${point.label}: ${formatUsdt(point.value)}`}
            >
              <span
                className={cn(
                  // Rounded data-end anchored to the baseline.
                  "w-full rounded-t-[4px] transition-colors duration-150",
                  selected === null
                    ? "bg-brand/70 group-hover:bg-brand"
                    : isActive
                      ? "bg-brand"
                      : "bg-brand/25 group-hover:bg-brand/45",
                )}
                style={{ height: `${heightPercent}%` }}
              />
            </button>
          );
        })}
      </div>

      {/* Recessive axis labels. */}
      <div className="flex gap-1.5" aria-hidden>
        {points.map((point, index) => (
          <span
            key={point.label}
            className={cn(
              "flex-1 text-center text-[11px] transition-colors",
              selected === index
                ? "font-medium text-foreground"
                : "text-muted-foreground",
            )}
          >
            {point.label}
          </span>
        ))}
      </div>

      {/* Screen-reader equivalent of the plotted data. */}
      <table id={tableId} className="sr-only">
        <caption>{totalLabel} breakdown</caption>
        <thead>
          <tr>
            <th scope="col">Period</th>
            <th scope="col">Profit (USDT)</th>
          </tr>
        </thead>
        <tbody>
          {points.map((point) => (
            <tr key={point.label}>
              <th scope="row">{point.label}</th>
              <td>{formatUsdt(point.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
