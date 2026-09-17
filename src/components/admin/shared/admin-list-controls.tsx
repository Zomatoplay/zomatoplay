"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  ClearFiltersButton,
  FilterBar,
  FilterChips,
  FilterSelect,
  SearchField,
  type FilterOption,
} from "@/components/admin/shared/filter-bar";
import {
  buildAdminListQueryString,
  hasActiveFilters,
  NO_FILTER,
  type AdminListSpec,
} from "@/lib/admin-list-query";
import { cn } from "@/lib/utils";
import type { AdminListQuery, PagedResult } from "@/types/admin";

/**
 * Filtering, searching, sorting and pagination for a server-paginated list.
 *
 * WHAT MOVED, AND WHY THE CONTROLS STILL FEEL LOCAL
 * ------------------------------------------------
 * These used to be `useState` over a complete copy of the table: the browser
 * held every row and `filter()`ed it. They now write the URL, the server
 * re-runs the query, and the screen re-renders with ten rows. The risk in that
 * trade is latency — a filter that was instant becomes a round trip.
 *
 * `useTransition` is what keeps it from feeling like one, and the whole screen
 * shares **one** transition through `useAdminListNavigation` so the controls,
 * the pager and the rows agree about whether something is in flight. React
 * keeps the current rows on screen while the next page is fetched; the list
 * dims rather than blanking, because content that is merely stale still tells
 * the operator more than a spinner does.
 *
 * Search is debounced and uses `replace` — a keystroke is not a navigation and
 * thirty of them are not thirty history entries. Everything else uses `push`,
 * so Back returns to the previous queue.
 */

/** Long enough to finish a word, short enough not to feel laggy. */
const SEARCH_DEBOUNCE_MS = 300;

export interface AdminListNavigation {
  isPending: boolean;
  search: string;
  setSearch: (value: string) => void;
  navigate: (patch: Partial<AdminListQuery>) => void;
  goToPage: (page: number) => void;
  clear: () => void;
}

/** The one transition a list screen navigates through. */
export function useAdminListNavigation(
  query: AdminListQuery,
  spec: AdminListSpec,
  /**
   * The key prefix this list owns, on a page that carries more than one.
   * Empty for a screen with a single table, which is all of them but
   * `/admin/referrals`.
   */
  prefix = "",
): AdminListNavigation {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(query.search);

  /*
   * The URL is the source of truth, so a Back/Forward or a *Clear* that
   * changes `q` has to reach the input. Tracking what this component last
   * pushed is what tells a server value that came from elsewhere apart from
   * the echo of our own keystroke — without it the box fights the URL.
   */
  const lastPushed = useRef(query.search);
  useEffect(() => {
    if (query.search !== lastPushed.current) {
      lastPushed.current = query.search;
      setSearch(query.search);
    }
  }, [query.search]);

  const hrefFor = useCallback(
    (patch: Partial<AdminListQuery>) =>
      `${pathname}${buildAdminListQueryString(query, patch, spec, {
        base: searchParams,
        prefix,
      })}`,
    [pathname, query, spec, searchParams, prefix],
  );

  useEffect(() => {
    if (search === query.search) return;
    const timer = setTimeout(() => {
      lastPushed.current = search;
      startTransition(() => router.replace(hrefFor({ search }), { scroll: false }));
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, query.search, hrefFor, router]);

  return {
    isPending,
    search,
    setSearch,
    navigate: (patch) =>
      startTransition(() => router.push(hrefFor(patch), { scroll: false })),
    goToPage: (page) =>
      startTransition(() => router.push(hrefFor({ page }), { scroll: false })),
    clear: () => {
      setSearch("");
      lastPushed.current = "";
      // Clears this list's keys only — on a two-table page the sibling keeps
      // whatever it was showing.
      const href = `${pathname}${buildAdminListQueryString(
        query,
        {
          search: "",
          status: spec.defaultStatus,
          filter: spec.defaultFilter ?? NO_FILTER,
          sort: spec.defaultSort,
          page: 1,
        },
        spec,
        { base: searchParams, prefix },
      )}`;
      startTransition(() => router.push(href, { scroll: false }));
    },
  };
}

export function AdminListControls({
  nav,
  query,
  spec,
  searchLabel,
  searchPlaceholder,
  statusOptions,
  filterOptions,
  sortOptions,
  filterLabel,
  statusLabel = "Filter by status",
}: {
  nav: AdminListNavigation;
  query: AdminListQuery;
  spec: AdminListSpec;
  searchLabel: string;
  searchPlaceholder: string;
  statusOptions: FilterOption<string>[];
  sortOptions: FilterOption<string>[];
  filterOptions?: FilterOption<string>[];
  filterLabel?: string;
  statusLabel?: string;
}) {
  return (
    <div className="space-y-4">
      <FilterBar>
        <SearchField
          value={nav.search}
          onChange={nav.setSearch}
          label={searchLabel}
          placeholder={searchPlaceholder}
        />
        {filterOptions ? (
          <FilterSelect
            options={filterOptions}
            value={query.filter}
            onChange={(filter) => nav.navigate({ filter })}
            label={filterLabel ?? "Filter"}
          />
        ) : null}
        <FilterSelect
          options={sortOptions}
          value={query.sort}
          onChange={(sort) => nav.navigate({ sort })}
          label="Sort"
        />
        <ClearFiltersButton
          disabled={!hasActiveFilters(query, spec)}
          onClear={nav.clear}
        />
      </FilterBar>

      {statusOptions.length > 1 ? (
        <FilterChips
          options={statusOptions}
          value={query.status}
          onChange={(status) => nav.navigate({ status })}
          label={statusLabel}
        />
      ) : null}
    </div>
  );
}

/**
 * Previous / Next over a server-counted set.
 *
 * `total` is the size of the filtered set rather than of the page, so the
 * range it reads out ("11-20 of 3,412") is the truth about the query and not
 * about what was sent to the browser.
 */
export function AdminListPager({
  nav,
  result,
  label,
}: {
  nav: AdminListNavigation;
  result: PagedResult<unknown>;
  /** Plural noun for the rows, e.g. "users". */
  label: string;
}) {
  const first = result.total === 0 ? 0 : (result.page - 1) * result.pageSize + 1;
  const last = Math.min(result.total, result.page * result.pageSize);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
      <p className="tabular text-xs text-muted-foreground" aria-live="polite">
        {result.total === 0
          ? `No ${label}`
          : `${first}–${last} of ${result.total.toLocaleString()} ${label}`}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => nav.goToPage(result.page - 1)}
          disabled={result.page <= 1 || nav.isPending}
          aria-label="Previous page"
        >
          <ChevronLeft className="size-4" aria-hidden />
          <span className="sr-only sm:not-sr-only">Previous</span>
        </Button>
        <span className="tabular px-1 text-xs text-muted-foreground">
          {result.page} / {result.pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => nav.goToPage(result.page + 1)}
          disabled={result.page >= result.pageCount || nav.isPending}
          aria-label="Next page"
        >
          <span className="sr-only sm:not-sr-only">Next</span>
          <ChevronRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/**
 * Keeps the previous rows readable while the next page is in flight.
 *
 * A list that blanks on every filter click reads as slower than one that
 * dims — the content is still there, and it is still what the operator was
 * looking at. `aria-busy` says so for a screen reader, and pointer events are
 * suspended so a row action cannot be aimed at a row that is about to be
 * replaced.
 */
export function AdminListBody({
  nav,
  children,
}: {
  nav: AdminListNavigation;
  children: React.ReactNode;
}) {
  return (
    <div
      aria-busy={nav.isPending}
      className={cn(
        "transition-opacity duration-150",
        nav.isPending && "pointer-events-none opacity-60",
      )}
    >
      {children}
    </div>
  );
}
