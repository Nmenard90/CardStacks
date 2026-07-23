/**
 * File: search-schemas.test.ts
 * Purpose:
 *   Tests search input validation, including the empty-query rejection that
 *   distinguishes search from explicit set/card browsing.
 *
 * Why this file exists:
 *   FR-CAT-004 requires at least one meaningful search filter. Browsing an
 *   entire set/catalog without a filter is a distinct, explicit action
 *   handled by the catalog module's own bounded endpoints, not search.
 */

import { describe, expect, it } from "vitest";
import { searchCardsQuerySchema } from "../modules/search/search.schemas.js";

describe("searchCardsQuerySchema", () => {
  it("rejects a request with no name, set, or number filter", () => {
    expect(() => searchCardsQuerySchema.parse({})).toThrow();
  });

  it("rejects a whitespace-only name as equivalent to no filter", () => {
    expect(() => searchCardsQuerySchema.parse({ q: "   " })).toThrow();
  });

  it("accepts a name-only search", () => {
    const result = searchCardsQuerySchema.parse({ q: "Charizard" });
    expect(result.q).toBe("Charizard");
  });

  it("accepts a set-only search", () => {
    const result = searchCardsQuerySchema.parse({ setId: "sv1" });
    expect(result.setId).toBe("sv1");
  });

  it("accepts a number-only search", () => {
    const result = searchCardsQuerySchema.parse({ number: "080" });
    expect(result.number).toBe("080");
  });

  it("defaults page and limit and caps limit at 50", () => {
    expect(searchCardsQuerySchema.parse({ q: "pikachu" })).toMatchObject({ page: 1, limit: 25 });
    expect(() => searchCardsQuerySchema.parse({ q: "pikachu", limit: 500 })).toThrow();
  });

  it("rejects a name longer than the allowed bound", () => {
    expect(() => searchCardsQuerySchema.parse({ q: "a".repeat(200) })).toThrow();
  });
});
