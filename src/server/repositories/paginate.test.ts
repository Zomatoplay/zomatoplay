import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { likePattern, readPage } from "./paginate";
import type { AdminListQuery } from "@/types/admin";

const query = (over: Partial<AdminListQuery> = {}): AdminListQuery => ({
  page: 1,
  pageSize: 10,
  search: "",
  status: "all",
  filter: "all",
  sort: "recent",
  ...over,
});

describe("likePattern", () => {
  test("wraps the needle so it matches anywhere", () => {
    assert.equal(likePattern("aarav"), "%aarav%");
  });

  test("neutralises LIKE's own wildcards", () => {
    /*
     * The one that matters. Unescaped, a search for `%` is `%%%` — which
     * matches every row in the table, so an empty search box and a search for
     * a single character return the same thing and nobody notices until the
     * table is large. `_` is the same defect one row at a time.
     */
    assert.equal(likePattern("%"), "%\\%%");
    assert.equal(likePattern("100%"), "%100\\%%");
    assert.equal(likePattern("a_b"), "%a\\_b%");
  });

  test("escapes the escape character first", () => {
    // Replacing `\` after `%` would re-break what the `%` rule just fixed.
    assert.equal(likePattern("a\\b"), "%a\\\\b%");
    assert.equal(likePattern("\\%"), "%\\\\\\%%");
  });
});

describe("readPage", () => {
  test("reports the filtered total, not the page size", async () => {
    const result = await readPage(query(), async () => ({
      rows: Array.from({ length: 10 }, (_, i) => i),
      total: 94,
    }));

    assert.equal(result.rows.length, 10);
    assert.equal(result.total, 94);
    assert.equal(result.page, 1);
    assert.equal(result.pageCount, 10);
  });

  test("an empty set still reads as page 1 of 1", async () => {
    const result = await readPage(query(), async () => ({ rows: [], total: 0 }));
    assert.equal(result.page, 1);
    assert.equal(result.pageCount, 1);
    assert.equal(result.total, 0);
  });

  test("a page past the end falls back to page 1", async () => {
    /*
     * A stale link, a bookmark, or a filter that narrowed the set since. The
     * alternative is an empty screen on a queue that has plenty in it, which
     * an operator reads as "nothing to do".
     */
    const asked: number[] = [];
    const result = await readPage(query({ page: 40 }), async (page) => {
      asked.push(page);
      return page === 1
        ? { rows: [1, 2, 3], total: 3 }
        : { rows: [], total: 0 };
    });

    assert.deepEqual(asked, [40, 1]);
    assert.equal(result.page, 1);
    assert.equal(result.total, 3);
    assert.equal(result.rows.length, 3);
  });

  test("does not retry an empty page 1", async () => {
    // Otherwise every genuinely empty queue costs two round trips.
    let calls = 0;
    await readPage(query(), async () => {
      calls += 1;
      return { rows: [], total: 0 };
    });
    assert.equal(calls, 1);
  });

  test("clamps the reported page to the page count", async () => {
    const result = await readPage(query({ page: 3 }), async () => ({
      rows: [1],
      total: 11,
    }));
    assert.equal(result.pageCount, 2);
    assert.equal(result.page, 2);
  });
});
