"use client";

import { useId, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * The table primitive behind every list screen in the Master CRM.
 *
 * Two renderings of the same rows:
 *   ≥ `md` — a real `<table>` inside its own horizontal scroll container, so a
 *            wide table never makes the *page* scroll sideways.
 *   < `md` — a card list, because a twelve-column table crammed into 360px is
 *            not a readable table, it is a broken one.
 *
 * Both come from one `rows` array and one column definition, so the mobile view
 * can never drift out of sync with the desktop one.
 */

export interface DataTableColumn<T> {
  id: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  /** Right-align and use tabular figures. For amounts, counts and dates. */
  numeric?: boolean;
  /** Progressive disclosure: drop lower-priority columns on narrower screens. */
  hideBelow?: "lg" | "xl";
  /** Fixed column width, e.g. `w-40`. */
  width?: string;
  /** Header is present for screen readers but not painted (action columns). */
  srOnlyHeader?: boolean;
}

/** Literal class strings — Tailwind cannot see classes built at runtime. */
const HIDE_BELOW: Record<NonNullable<DataTableColumn<unknown>["hideBelow"]>, string> =
  {
    lg: "hidden lg:table-cell",
    xl: "hidden xl:table-cell",
  };

interface DataTableProps<T> {
  rows: T[];
  columns: DataTableColumn<T>[];
  getRowKey: (row: T) => string;
  /** Card rendering for narrow screens. */
  renderCard: (row: T) => React.ReactNode;
  /** Accessible description of the table's contents. */
  caption: string;
  /** Shown when `rows` is empty. */
  empty: React.ReactNode;
  /** Rows per page. Omit to render every row without pagination. */
  pageSize?: number;
  /**
   * Change this whenever the filter or search criteria change, so pagination
   * returns to the first page instead of stranding the operator on an empty
   * page 4.
   */
  resetKey?: string;
  className?: string;
}

export function DataTable<T>({
  rows,
  columns,
  getRowKey,
  renderCard,
  caption,
  empty,
  pageSize,
  resetKey = "",
  className,
}: DataTableProps<T>) {
  const captionId = useId();
  const [page, setPage] = useState(0);
  const [lastResetKey, setLastResetKey] = useState(resetKey);

  // Adjusting state during render is the documented React pattern for
  // "reset derived state when a prop changes" — cheaper and flicker-free
  // compared with doing it in an effect after paint.
  if (resetKey !== lastResetKey) {
    setLastResetKey(resetKey);
    setPage(0);
  }

  const pageCount = pageSize ? Math.max(1, Math.ceil(rows.length / pageSize)) : 1;
  // Rows can shrink under the current page (a filter narrowed the set between
  // renders); clamp rather than showing an empty page.
  const currentPage = Math.min(page, pageCount - 1);
  const visibleRows = pageSize
    ? rows.slice(currentPage * pageSize, currentPage * pageSize + pageSize)
    : rows;

  if (rows.length === 0) {
    return <div className={className}>{empty}</div>;
  }

  return (
    <div className={cn("space-y-3", className)}>
      {/* Desktop: a real table, scrolling inside its own container. */}
      <div className="hidden overflow-hidden rounded-2xl border border-border bg-card md:block">
        {/*
          `relative` is load-bearing, not cosmetic. The visually-hidden caption
          and the `sr-only` action-column headers are `position: absolute`, and
          an absolutely positioned box is only clipped by an ancestor scroller
          when that scroller is also its containing block. Without `relative`
          their containing block is the viewport, so they sit at the *table's*
          x-offset — well past the right edge — and make the whole document
          horizontally scrollable even though the table itself is clipped.
        */}
        <div className="relative overflow-x-auto">
          <table className="w-full border-collapse text-sm" aria-describedby={captionId}>
            <caption id={captionId} className="sr-only">
              {caption}
            </caption>
            <thead>
              <tr className="border-b border-border bg-secondary/40">
                {columns.map((column) => (
                  <th
                    key={column.id}
                    scope="col"
                    className={cn(
                      "whitespace-nowrap px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground",
                      column.numeric ? "text-right" : "text-left",
                      column.width,
                      column.hideBelow && HIDE_BELOW[column.hideBelow],
                    )}
                  >
                    <span className={cn(column.srOnlyHeader && "sr-only")}>
                      {column.header}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {visibleRows.map((row) => (
                <tr
                  key={getRowKey(row)}
                  className="transition-colors hover:bg-secondary/40"
                >
                  {columns.map((column) => (
                    <td
                      key={column.id}
                      className={cn(
                        "px-3 py-2.5 align-middle",
                        column.numeric && "tabular text-right",
                        column.hideBelow && HIDE_BELOW[column.hideBelow],
                      )}
                    >
                      {column.cell(row)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile: the same rows as cards. */}
      <ul className="space-y-2.5 md:hidden">
        {visibleRows.map((row) => (
          <li key={getRowKey(row)}>{renderCard(row)}</li>
        ))}
      </ul>

      {pageSize && rows.length > pageSize ? (
        <TablePagination
          page={currentPage}
          pageCount={pageCount}
          total={rows.length}
          pageSize={pageSize}
          onChange={setPage}
        />
      ) : (
        <p className="px-1 text-xs text-muted-foreground">
          {rows.length} {rows.length === 1 ? "record" : "records"}
        </p>
      )}
    </div>
  );
}

function TablePagination({
  page,
  pageCount,
  total,
  pageSize,
  onChange,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onChange: (page: number) => void;
}) {
  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <p className="text-xs text-muted-foreground" aria-live="polite">
        Showing <span className="tabular font-medium text-foreground">{first}</span>
        –<span className="tabular font-medium text-foreground">{last}</span> of{" "}
        <span className="tabular font-medium text-foreground">{total}</span>
      </p>
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(page - 1)}
          disabled={page === 0}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" />
          <span className="hidden sm:inline">Previous</span>
        </Button>
        <span className="tabular px-2 text-xs text-muted-foreground">
          {page + 1} / {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onChange(page + 1)}
          disabled={page >= pageCount - 1}
          aria-label="Next page"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="size-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Card shell for the narrow-screen rendering of a table row. Keeps the mobile
 * view visually consistent across every list screen.
 */
export function DataCard({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "space-y-2.5 rounded-2xl border border-border bg-card p-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Label/value pair inside a `DataCard`. */
export function DataCardRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex items-start justify-between gap-3 text-sm", className)}
    >
      <span className="shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words text-right font-medium">
        {children}
      </span>
    </div>
  );
}

/** The two-line primary cell used in most CRM tables: a name over an id. */
export function PrimaryCell({
  title,
  subtitle,
  className,
}: {
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  className?: string;
}) {
  return (
    <span className={cn("flex min-w-0 flex-col", className)}>
      <span className="truncate font-medium text-foreground">{title}</span>
      {subtitle ? (
        <span className="tabular truncate text-xs text-muted-foreground">
          {subtitle}
        </span>
      ) : null}
    </span>
  );
}
