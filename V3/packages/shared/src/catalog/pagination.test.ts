import { describe, expect, it } from "vitest";
import { buildPageInfo } from "./pagination.js";

describe("buildPageInfo", () => {
  it("computes total pages by rounding up", () => {
    expect(buildPageInfo(1, 25, 51)).toEqual({ page: 1, limit: 25, total: 51, totalPages: 3 });
  });

  it("reports zero total pages for an empty result set", () => {
    expect(buildPageInfo(1, 25, 0)).toEqual({ page: 1, limit: 25, total: 0, totalPages: 0 });
  });

  it("reports exactly one page when total equals the limit", () => {
    expect(buildPageInfo(2, 10, 10)).toEqual({ page: 2, limit: 10, total: 10, totalPages: 1 });
  });
});
