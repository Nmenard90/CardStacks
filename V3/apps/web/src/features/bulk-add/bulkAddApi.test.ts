import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupCardsByNumber, MAX_LOOKUP_MATCHES } from "./bulkAddApi.js";
import { searchCards, type SearchCardsResult, type SearchResultCard } from "../search/searchApi.js";

vi.mock("../search/searchApi.js", () => ({
  searchCards: vi.fn()
}));

const mockedSearchCards = vi.mocked(searchCards);

afterEach(() => {
  mockedSearchCards.mockReset();
});

function makeCard(id: string, setId: string): SearchResultCard {
  return { id, setId, name: `Card ${id}`, number: "080", set: { id: setId, name: `Set ${setId}`, series: "SV" } };
}

function makePage(items: SearchResultCard[], page: number, total: number, limit = 50): SearchCardsResult {
  return { items, pageInfo: { page, limit, total, totalPages: Math.ceil(total / limit) }, ambiguous: total > 0 };
}

describe("lookupCardsByNumber", () => {
  it("returns a single page of matches without extra requests when everything fits on page 1", async () => {
    const items = [makeCard("a", "sv1"), makeCard("b", "swsh1")];
    mockedSearchCards.mockResolvedValueOnce(makePage(items, 1, 2));

    const result = await lookupCardsByNumber("080");

    expect(mockedSearchCards).toHaveBeenCalledTimes(1);
    expect(result.matches).toHaveLength(2);
    expect(result.truncated).toBe(false);
  });

  it("fetches every page of an ambiguous cross-set match instead of silently truncating to 50 (COL review: bulk lookup pagination)", async () => {
    const total = 120;
    const page1 = Array.from({ length: 50 }, (_, i) => makeCard(`p1-${i}`, "sv1"));
    const page2 = Array.from({ length: 50 }, (_, i) => makeCard(`p2-${i}`, "swsh1"));
    const page3 = Array.from({ length: 20 }, (_, i) => makeCard(`p3-${i}`, "base1"));

    mockedSearchCards
      .mockResolvedValueOnce(makePage(page1, 1, total))
      .mockResolvedValueOnce(makePage(page2, 2, total))
      .mockResolvedValueOnce(makePage(page3, 3, total));

    const result = await lookupCardsByNumber("1");

    expect(mockedSearchCards).toHaveBeenCalledTimes(3);
    expect(result.matches).toHaveLength(total);
    expect(result.truncated).toBe(false);
  });

  it("stops at the bounded page cap and reports truncation instead of fetching an unbounded number of pages", async () => {
    const totalBeyondCap = MAX_LOOKUP_MATCHES + 250;
    mockedSearchCards.mockResolvedValue(makePage([makeCard("x", "sv1")], 1, totalBeyondCap));

    const result = await lookupCardsByNumber("1");

    // 10 pages of 50 = MAX_LOOKUP_MATCHES; never more requests than that even
    // though the true total is much larger.
    expect(mockedSearchCards).toHaveBeenCalledTimes(MAX_LOOKUP_MATCHES / 50);
    expect(result.truncated).toBe(true);
  });

  it("passes the set id filter through to every page it fetches", async () => {
    const total = 60;
    mockedSearchCards
      .mockResolvedValueOnce(makePage(Array.from({ length: 50 }, (_, i) => makeCard(`a-${i}`, "sv1")), 1, total))
      .mockResolvedValueOnce(makePage(Array.from({ length: 10 }, (_, i) => makeCard(`b-${i}`, "sv1")), 2, total));

    await lookupCardsByNumber("080", "sv1");

    expect(mockedSearchCards).toHaveBeenNthCalledWith(1, { number: "080", setId: "sv1", page: 1, limit: 50 });
    expect(mockedSearchCards).toHaveBeenNthCalledWith(2, { number: "080", setId: "sv1", page: 2, limit: 50 });
  });
});
