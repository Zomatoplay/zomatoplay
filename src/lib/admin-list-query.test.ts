import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  buildAdminListQueryString,
  hasActiveFilters,
  parseAdminListQuery,
  type AdminListSpec,
} from "./admin-list-query";

/**
 * The CRM list screens' URL contract.
 *
 * Everything here arrives from a query string, so these are the checks that
 * stop a crafted URL reaching a query. They need no database: the parser is
 * pure, which is the point of keeping it out of the repositories.
 */

const SPEC: AdminListSpec = {
  statuses: ["all", "active", "blocked"],
  sorts: ["recent", "name"],
  defaultStatus: "all",
  defaultSort: "recent",
};

describe("parseAdminListQuery", () => {
  test("reads a well-formed query", () => {
    const q = parseAdminListQuery(
      { page: "3", q: " aarav ", status: "blocked", sort: "name", filter: "approved" },
      SPEC,
    );
    assert.equal(q.page, 3);
    assert.equal(q.search, "aarav");
    assert.equal(q.status, "blocked");
    assert.equal(q.sort, "name");
    assert.equal(q.filter, "approved");
  });

  test("falls back to the screen's defaults for unknown tokens", () => {
    // `status` and `sort` select SQL structure — an enum cast and an ORDER BY
    // — so anything off the allowlist must never reach the query.
    const q = parseAdminListQuery(
      { status: "'; drop table users;--", sort: "(select 1)" },
      SPEC,
    );
    assert.equal(q.status, "all");
    assert.equal(q.sort, "recent");
  });

  test("refuses a page that is not a positive number", () => {
    for (const page of ["0", "-5", "abc", "", "NaN"]) {
      assert.equal(parseAdminListQuery({ page }, SPEC).page, 1, `page=${page}`);
    }
  });

  test("clamps an absurd page rather than overflowing OFFSET", () => {
    /*
     * `?page=99999999999999999999` parses to a finite number and became
     * `OFFSET 999999999999999990000`, which overflows Postgres's bigint:
     * `pg_strtoint64_safe` raises and the screen renders its error page.
     */
    const q = parseAdminListQuery({ page: "99999999999999999999" }, SPEC);
    assert.ok(q.page <= 1_000_000, `expected a clamped page, got ${q.page}`);
    assert.ok(Number.isSafeInteger((q.page - 1) * q.pageSize));
  });

  test("page size is never taken from the URL", () => {
    // A caller-chosen page size is an unbounded read wearing a parameter.
    const q = parseAdminListQuery({ pageSize: "100000", limit: "100000" }, SPEC);
    assert.equal(q.pageSize, 10);
  });

  test("bounds the search string", () => {
    const q = parseAdminListQuery({ q: "x".repeat(5000) }, SPEC);
    assert.equal(q.search.length, 100);
  });

  test("takes the first value when a parameter repeats", () => {
    const q = parseAdminListQuery({ status: ["blocked", "active"] }, SPEC);
    assert.equal(q.status, "blocked");
  });

  test("reads prefixed keys, for a page carrying two lists", () => {
    const params = { apage: "2", cpage: "5", cq: "bonus" };
    assert.equal(parseAdminListQuery(params, SPEC, "a").page, 2);
    assert.equal(parseAdminListQuery(params, SPEC, "c").page, 5);
    assert.equal(parseAdminListQuery(params, SPEC, "c").search, "bonus");
    assert.equal(parseAdminListQuery(params, SPEC, "a").search, "");
  });
});

describe("buildAdminListQueryString", () => {
  const base = parseAdminListQuery({}, SPEC);

  test("omits defaults, so an unfiltered screen has a bare URL", () => {
    assert.equal(buildAdminListQueryString(base, {}, SPEC), "");
  });

  test("changing anything but the page returns to page 1", () => {
    /*
     * Keeping the page across a filter change strands an operator on an empty
     * page 7 of a set that now has two — which reads as "no results" for a
     * filter that has plenty.
     */
    const onPageSeven = { ...base, page: 7 };
    assert.equal(
      buildAdminListQueryString(onPageSeven, { status: "blocked" }, SPEC),
      "?status=blocked",
    );
    assert.equal(
      buildAdminListQueryString(onPageSeven, { page: 8 }, SPEC),
      "?page=8",
    );
  });

  test("preserves the sibling list's parameters", () => {
    // `/admin/referrals` carries two tables; paging one must not reset the
    // other.
    const href = buildAdminListQueryString(base, { page: 3 }, SPEC, {
      base: new URLSearchParams("cpage=4&cq=bonus"),
      prefix: "a",
    });
    assert.ok(href.includes("apage=3"), href);
    assert.ok(href.includes("cpage=4"), href);
    assert.ok(href.includes("cq=bonus"), href);
  });

  test("clears its own keys when they return to their default", () => {
    const filtered = { ...base, status: "blocked" };
    const href = buildAdminListQueryString(filtered, { status: "all" }, SPEC, {
      base: new URLSearchParams("status=blocked&cpage=2"),
    });
    assert.ok(!href.includes("status="), href);
    assert.ok(href.includes("cpage=2"), href);
  });
});

describe("hasActiveFilters", () => {
  test("is false for the untouched screen and true for any narrowing", () => {
    const base = parseAdminListQuery({}, SPEC);
    assert.equal(hasActiveFilters(base, SPEC), false);
    assert.equal(hasActiveFilters({ ...base, search: "a" }, SPEC), true);
    assert.equal(hasActiveFilters({ ...base, status: "blocked" }, SPEC), true);
    assert.equal(hasActiveFilters({ ...base, sort: "name" }, SPEC), true);
    assert.equal(hasActiveFilters({ ...base, filter: "approved" }, SPEC), true);
    // The page is not a filter — *Clear* must not light up on page 2.
    assert.equal(hasActiveFilters({ ...base, page: 2 }, SPEC), false);
  });
});
