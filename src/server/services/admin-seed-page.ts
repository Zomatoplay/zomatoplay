import "server-only";

import type { AdminListQuery, PagedResult } from "@/types/admin";

/**
 * The paginated list screens' no-database path.
 *
 * With `DATABASE_URL` unset the CRM still runs on the fixtures in
 * `@/data/admin` (CLAUDE.md §16.3), and the list screens now ask for a page
 * rather than a table — so the fallback has to be able to answer that shape
 * too. It filters and slices the fixture array in memory, which is exactly
 * what the *browser* used to do with real rows and is fine here: the fixture
 * is thirty records and it is not anybody's money.
 *
 * It is deliberately not a second implementation of each screen's predicates.
 * A caller supplies the one matcher it needs, so a screen whose SQL and
 * fixture filters disagree does so in one visible place rather than silently.
 */
export function pageSeed<T>(
  all: readonly T[],
  query: AdminListQuery,
  matcher: (item: T, query: AdminListQuery) => boolean,
  compare?: (a: T, b: T, sort: string) => number,
): PagedResult<T> {
  const matched = all.filter((item) => matcher(item, query));
  const sorted = compare
    ? [...matched].sort((a, b) => compare(a, b, query.sort))
    : matched;

  const pageCount = Math.max(1, Math.ceil(sorted.length / query.pageSize));

  /*
   * A page past the end returns **page 1**, not the last page.
   *
   * Clamping to the last page reads better, and it is what this function did
   * first — but the database path cannot do it. There, an over-range page
   * comes back empty, and the total rides on the rows as a window function,
   * so an empty result carries no total to clamp against; `readPage` asks
   * again for page 1 instead. Two modes disagreeing about the same URL is the
   * bug §16.3 exists to prevent, so the fixture path matches the real one
   * rather than being quietly nicer.
   */
  const page = query.page > pageCount ? 1 : Math.max(1, query.page);
  const start = (page - 1) * query.pageSize;

  return {
    rows: sorted.slice(start, start + query.pageSize),
    total: sorted.length,
    page,
    pageSize: query.pageSize,
    pageCount,
  };
}

/** Case-insensitive substring match over the fields a screen searches. */
export function seedSearchMatches(
  search: string,
  fields: (string | null | undefined)[],
): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return fields.some((field) => field?.toLowerCase().includes(needle));
}

/**
 * The fixture equivalent of a screen's status-chip counts.
 *
 * Counts under every filter *except* the status itself, matching what the SQL
 * facet query does — otherwise the unselected chips would all read zero.
 */
export function seedStatusCounts<T>(
  all: readonly T[],
  query: AdminListQuery,
  matcher: (item: T, query: AdminListQuery) => boolean,
  statusOf: (item: T) => string,
): Record<string, number> {
  const ignoringStatus = { ...query, status: "all" };
  const counts: Record<string, number> = { all: 0 };
  for (const item of all) {
    if (!matcher(item, ignoringStatus)) continue;
    const status = statusOf(item);
    counts[status] = (counts[status] ?? 0) + 1;
    counts.all += 1;
  }
  return counts;
}
