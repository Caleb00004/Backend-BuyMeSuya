import { describe, it, expect } from "vitest";
import { parsePagination, buildPaginationMeta } from "../../utils/helpers";

describe("parsePagination", () => {
  describe("defaults when nothing is provided", () => {
    it("defaults page to 1 and limit to 15 when query is empty", () => {
      expect(parsePagination({})).toEqual({ page: 1, limit: 15, offset: 0 });
    });

    it("defaults page when page is undefined but limit is provided", () => {
      const result = parsePagination({ limit: "20" });
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
    });

    it("defaults limit when limit is undefined but page is provided", () => {
      const result = parsePagination({ page: "3" });
      expect(result.page).toBe(3);
      expect(result.limit).toBe(15);
    });
  });

  describe("valid numeric strings", () => {
    it("parses valid page and limit strings", () => {
      expect(parsePagination({ page: "2", limit: "10" })).toEqual({
        page: 2,
        limit: 10,
        offset: 10,
      });
    });

    it("computes offset correctly for page 1", () => {
      expect(parsePagination({ page: "1", limit: "15" }).offset).toBe(0);
    });

    it("computes offset correctly for a later page", () => {
      expect(parsePagination({ page: "4", limit: "15" }).offset).toBe(45);
    });

    it("accepts numbers (not just strings) since parseInt coerces them", () => {
      expect(parsePagination({ page: 2, limit: 10 })).toEqual({
        page: 2,
        limit: 10,
        offset: 10,
      });
    });
  });

  describe("invalid / garbage input falls back to defaults", () => {
    it("falls back when page is non-numeric", () => {
      expect(parsePagination({ page: "abc", limit: "10" }).page).toBe(1);
    });

    it("falls back when limit is non-numeric", () => {
      expect(parsePagination({ page: "2", limit: "abc" }).limit).toBe(15);
    });

    it("falls back when page is null", () => {
      expect(parsePagination({ page: null, limit: 10 }).page).toBe(1);
    });

    it("falls back when limit is an empty string", () => {
      expect(parsePagination({ page: 1, limit: "" }).limit).toBe(15);
    });

    it("falls back when page is an object", () => {
      expect(parsePagination({ page: {}, limit: 10 }).page).toBe(1);
    });
  });

  describe("boundary values", () => {
    it("treats page 0 as invalid and falls back to 1", () => {
      expect(parsePagination({ page: "0", limit: "10" }).page).toBe(1);
    });

    it("treats negative page as invalid and falls back to 1", () => {
      expect(parsePagination({ page: "-5", limit: "10" }).page).toBe(1);
    });

    it("treats limit 0 as invalid and falls back to default", () => {
      expect(parsePagination({ page: "1", limit: "0" }).limit).toBe(15);
    });

    it("treats negative limit as invalid and falls back to default", () => {
      expect(parsePagination({ page: "1", limit: "-10" }).limit).toBe(15);
    });

    it("accepts page 1 exactly (lower boundary)", () => {
      expect(parsePagination({ page: "1", limit: "10" }).page).toBe(1);
    });

    it("accepts limit 1 exactly (lower boundary)", () => {
      expect(parsePagination({ page: "1", limit: "1" }).limit).toBe(1);
    });
  });

  describe("clamping limit to MAX_PAGE_SIZE (50)", () => {
    it("clamps limit above 50 down to 50", () => {
      expect(parsePagination({ page: "1", limit: "1000" }).limit).toBe(50);
    });

    it("accepts limit exactly at 50 (upper boundary)", () => {
      expect(parsePagination({ page: "1", limit: "50" }).limit).toBe(50);
    });

    it("clamps limit at 51 down to 50", () => {
      expect(parsePagination({ page: "1", limit: "51" }).limit).toBe(50);
    });

    it("does not clamp page (no upper bound on page)", () => {
      expect(parsePagination({ page: "99999", limit: "10" }).page).toBe(99999);
    });
  });

  describe("decimal and malformed numeric strings", () => {
    it("truncates decimal page values (parseInt behavior)", () => {
      expect(parsePagination({ page: "2.9", limit: "10" }).page).toBe(2);
    });

    it("truncates decimal limit values (parseInt behavior)", () => {
      expect(parsePagination({ page: "1", limit: "10.9" }).limit).toBe(10);
    });

    it("parses leading digits from a mixed string (parseInt behavior)", () => {
      // parseInt("3abc", 10) === 3 — documenting this quirk so a future
      // change to stricter validation doesn't silently break expectations
      expect(parsePagination({ page: "3abc", limit: "10" }).page).toBe(3);
    });

    it("falls back when the string has no leading digits", () => {
      expect(parsePagination({ page: "abc3", limit: "10" }).page).toBe(1);
    });

    it("handles whitespace-padded numeric strings", () => {
      expect(parsePagination({ page: "  4  ", limit: "10" }).page).toBe(4);
    });
  });

  describe("non-finite values", () => {
    it("falls back when page is Infinity", () => {
      expect(parsePagination({ page: Infinity, limit: 10 }).page).toBe(1);
    });

    it("falls back when limit is NaN directly", () => {
      expect(parsePagination({ page: 1, limit: NaN }).limit).toBe(15);
    });
  });

  describe("array query values (can happen with real query strings, e.g. ?page=1&page=2)", () => {
    it("does not throw when page is an array", () => {
      expect(() => parsePagination({ page: ["1", "2"], limit: 10 })).not.toThrow();
    });

    it("does not throw when limit is an array", () => {
      expect(() => parsePagination({ page: 1, limit: ["10", "20"] })).not.toThrow();
    });
  });

  it("always returns integers, never NaN, for page/limit/offset", () => {
    const result = parsePagination({ page: "abc", limit: "xyz" });
    expect(Number.isInteger(result.page)).toBe(true);
    expect(Number.isInteger(result.limit)).toBe(true);
    expect(Number.isInteger(result.offset)).toBe(true);
  });
});

describe("buildPaginationMeta", () => {
  it("builds correct meta for a middle page with more pages ahead and behind", () => {
    expect(buildPaginationMeta(2, 15, 100)).toEqual({
      page: 2,
      limit: 15,
      total: 100,
      totalPages: 7,
      hasNextPage: true,
      hasPrevPage: true,
    });
  });

  it("marks hasPrevPage false and hasNextPage true on the first page", () => {
    const meta = buildPaginationMeta(1, 15, 100);
    expect(meta.hasPrevPage).toBe(false);
    expect(meta.hasNextPage).toBe(true);
  });

  it("marks hasNextPage false and hasPrevPage true on the last page", () => {
    const meta = buildPaginationMeta(7, 15, 100); // 100 / 15 = 6.67 -> 7 pages
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(true);
  });

  it("handles total exactly divisible by limit", () => {
    const meta = buildPaginationMeta(1, 10, 100); // exactly 10 pages
    expect(meta.totalPages).toBe(10);
  });

  it("rounds up totalPages when total is not evenly divisible by limit", () => {
    const meta = buildPaginationMeta(1, 15, 16); // 16/15 -> 2 pages
    expect(meta.totalPages).toBe(2);
  });

  it("handles zero total results (totalPages floors at 1, not 0)", () => {
    const meta = buildPaginationMeta(1, 15, 0);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(false);
  });

  it("handles a single result", () => {
    const meta = buildPaginationMeta(1, 15, 1);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNextPage).toBe(false);
  });

  it("correctly flags hasNextPage/hasPrevPage false when there's exactly one page total", () => {
    const meta = buildPaginationMeta(1, 15, 10);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNextPage).toBe(false);
    expect(meta.hasPrevPage).toBe(false);
  });

  it("still returns a sensible shape when the current page exceeds totalPages (e.g. stale pagination)", () => {
    // page 50 requested but only 2 pages actually exist
    const meta = buildPaginationMeta(50, 15, 20);
    expect(meta.totalPages).toBe(2);
    expect(meta.hasNextPage).toBe(false); // 50 < 2 is false
    expect(meta.hasPrevPage).toBe(true); // 50 > 1 is true
  });

  it("passes through page/limit/total unchanged in the returned object", () => {
    const meta = buildPaginationMeta(3, 25, 200);
    expect(meta.page).toBe(3);
    expect(meta.limit).toBe(25);
    expect(meta.total).toBe(200);
  });
});