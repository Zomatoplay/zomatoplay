import { ADMIN_PAGE_SIZE } from "@/constants/admin";
import type { AdminListQuery } from "@/types/admin";

/**
 * The URL is the state of a CRM list screen.
 *
 * WHY THE URL AND NOT `useState`
 * ------------------------------
 * Every list screen used to hold its filters in component state over a
 * complete copy of the table, so "filter to pending" was a JavaScript
 * `filter()` across rows the browser had already been sent. Moving the
 * predicates into SQL means the *server* has to know them, and a server
 * component reads its inputs from the URL — there is nowhere else for them to
 * come from. Three things come free with that: an operator can send a
 * colleague a link to the exact queue they are looking at, Back works, and a
 * refresh keeps the view.
 *
 * Both halves of the round trip parse through this module, so the token an
 * operator clicks and the token the query validates are the same list. A
 * screen adds a filter by adding it to its own spec below, and nowhere else.
 */

/** What one screen accepts. Anything outside these lists is discarded. */
export interface AdminListSpec {
  readonly statuses: readonly string[];
  readonly sorts: readonly string[];
  readonly defaultStatus: string;
  readonly defaultSort: string;
  /** The screen's second filter dimension; `"all"` when it has none. */
  readonly defaultFilter?: string;
}

/**
 * A search box is an unbounded text field pointed at a database. 100
 * characters is far more than any identifier this searches for, and it keeps
 * a pasted megabyte from becoming a `LIKE` pattern.
 */
const MAX_SEARCH_LENGTH = 100;

/** Long enough for any id this filters on, short enough to be uninteresting. */
const MAX_FILTER_LENGTH = 64;

/** The token every screen uses for "not filtered". */
export const NO_FILTER = "all";

/**
 * The highest page number that may reach a query.
 *
 * Not a guess about how many rows there could be — it is an overflow guard.
 * `page` becomes `OFFSET (page - 1) * pageSize`, Postgres's `OFFSET` is a
 * `bigint`, and a URL carrying `?page=99999999999999999999` parses to a finite
 * number that overflows it: `pg_strtoint64_safe` raises, and the screen
 * renders its error page. Clamping here keeps a crafted URL to an empty page
 * that `readPage` then turns back into page 1.
 */
const MAX_PAGE = 1_000_000;

/** The raw shape Next hands a page as `searchParams`. */
export type RawSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value) ?? "";
}

/**
 * URL → a validated query.
 *
 * Nothing here trusts its input: a page below 1, a non-numeric page, an
 * unknown status and an unknown sort all fall back to the screen's default
 * rather than reaching a query. `pageSize` is deliberately not read from the
 * URL at all — see `AdminListQuery`.
 */
export function parseAdminListQuery(
  params: RawSearchParams,
  spec: AdminListSpec,
  prefix = "",
): AdminListQuery {
  const key = (name: string) => (prefix ? `${prefix}${name}` : name);
  const rawPage = Number.parseInt(one(params[key("page")]), 10);
  const status = one(params[key("status")]);
  const sort = one(params[key("sort")]);

  return {
    page:
      Number.isFinite(rawPage) && rawPage > 0
        ? Math.min(rawPage, MAX_PAGE)
        : 1,
    pageSize: ADMIN_PAGE_SIZE,
    search: one(params[key("q")]).trim().slice(0, MAX_SEARCH_LENGTH),
    status: spec.statuses.includes(status) ? status : spec.defaultStatus,
    filter:
      one(params[key("filter")]).trim().slice(0, MAX_FILTER_LENGTH) ||
      defaultFilter(spec),
    sort: spec.sorts.includes(sort) ? sort : spec.defaultSort,
  };
}

/**
 * A query → a query string, with `patch` applied.
 *
 * **Changing anything but the page returns to page 1.** Keeping the page
 * across a filter change is how an operator lands on an empty page 7 of a set
 * that now has two pages, which reads as "no results" for a filter that has
 * plenty.
 *
 * Defaults are omitted rather than written out, so the unfiltered screen is
 * `/admin/users` and not `/admin/users?page=1&status=all&sort=recent`.
 */
export function buildAdminListQueryString(
  current: AdminListQuery,
  patch: Partial<AdminListQuery>,
  spec: AdminListSpec,
  /**
   * The URL's existing parameters, and the screen's own prefix.
   *
   * `base` is what lets a page carry **two** independent lists — the referral
   * screen has an account table and a commission ledger side by side. Each
   * owns a prefix, and rebuilding the query string from scratch would drop the
   * sibling's page the moment either was touched. Only this list's own keys
   * are set or cleared; everything else is passed through untouched.
   */
  options: { base?: URLSearchParams | ReadonlyURLSearchParamsLike; prefix?: string } = {},
): string {
  const prefix = options.prefix ?? "";
  const key = (name: string) => (prefix ? `${prefix}${name}` : name);

  const next = { ...current, ...patch };
  const changedBeyondPage = Object.keys(patch).some((k) => k !== "page");
  const page = changedBeyondPage ? 1 : next.page;

  const search = new URLSearchParams(options.base?.toString() ?? "");
  const put = (name: string, value: string, include: boolean) => {
    if (include) search.set(key(name), value);
    else search.delete(key(name));
  };

  put("q", next.search, next.search !== "");
  put("status", next.status, next.status !== spec.defaultStatus);
  put("filter", next.filter, next.filter !== defaultFilter(spec));
  put("sort", next.sort, next.sort !== spec.defaultSort);
  put("page", String(page), page > 1);

  const query = search.toString();
  return query ? `?${query}` : "";
}

/** `useSearchParams()` returns a read-only view; only `toString` is needed. */
interface ReadonlyURLSearchParamsLike {
  toString(): string;
}

/** True when anything is narrowing the list — drives the *Clear* control. */
export function hasActiveFilters(
  query: AdminListQuery,
  spec: AdminListSpec,
): boolean {
  return (
    query.search !== "" ||
    query.status !== spec.defaultStatus ||
    query.filter !== defaultFilter(spec) ||
    query.sort !== spec.defaultSort
  );
}

function defaultFilter(spec: AdminListSpec): string {
  return spec.defaultFilter ?? NO_FILTER;
}
