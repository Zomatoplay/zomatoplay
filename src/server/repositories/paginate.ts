import "server-only";

import { sql } from "drizzle-orm";

import type { AdminListQuery, PagedResult } from "@/types/admin";

/**
 * Helpers shared by the paginated CRM list reads.
 *
 * ONE STATEMENT, NOT TWO
 * ----------------------
 * A page needs its rows and the size of the filtered set, and the obvious way
 * to get both is two queries. On this deployment a round trip is ~200ms warm
 * and ~2,000ms cold (CLAUDE.md §16.1a), and two of them run in parallel still
 * occupy two of an instance's five connections — so the count rides along as a
 * window function over the same filtered scan instead. `count(*) over()` is
 * evaluated after `WHERE` and before `LIMIT`, which is exactly the number the
 * pager wants.
 *
 * The one case it cannot answer is a page past the end: no rows come back, so
 * no window value does either. `readPage` handles that by asking again for
 * page 1 rather than reporting a set of zero — an operator who followed a
 * stale link should see the list, not an empty screen implying the queue is
 * clear.
 */

/** The filtered-set size, carried on every row of the page. */
export const pageTotal = sql<number>`count(*) over()`;

/** What a paginated repository query must hand back for one page. */
export interface PageRows<T> {
  rows: T[];
  total: number;
}

/**
 * Runs a page query, retrying at page 1 when the requested page is past the
 * end of the filtered set.
 */
export async function readPage<T>(
  query: AdminListQuery,
  run: (page: number) => Promise<PageRows<T>>,
): Promise<PagedResult<T>> {
  let page = query.page;
  let result = await run(page);

  if (result.rows.length === 0 && page > 1) {
    page = 1;
    result = await run(page);
  }

  const pageCount = Math.max(1, Math.ceil(result.total / query.pageSize));
  return {
    rows: result.rows,
    total: result.total,
    page: Math.min(page, pageCount),
    pageSize: query.pageSize,
    pageCount,
  };
}

/**
 * `%needle%`, with LIKE's own wildcards neutralised.
 *
 * Without this a search for `100%` matches every row, and `_` matches any
 * character — a search box is not a pattern box. The backslash is the default
 * escape character for `LIKE`, so escaping it first keeps the other two
 * replacements from being undone.
 */
export function likePattern(search: string): string {
  const escaped = search
    .replace(/\\/g, "\\\\")
    .replace(/%/g, "\\%")
    .replace(/_/g, "\\_");
  return `%${escaped}%`;
}
