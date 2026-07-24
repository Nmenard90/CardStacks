import { describe, expect, it } from "vitest";
import { countDistinctSets, groupCandidatesBySet, isAmbiguousNumberSearch, isNumberOnlySearch } from "./ambiguity.js";

const cardInSetA = { id: "set-a-25", setId: "set-a" };
const cardInSetB = { id: "set-b-25", setId: "set-b" };
const secondCardInSetA = { id: "set-a-25-shadowless", setId: "set-a" };

describe("isAmbiguousNumberSearch", () => {
  it("is ambiguous when a number-only search spans multiple sets", () => {
    expect(isAmbiguousNumberSearch({ number: "25" }, [cardInSetA, cardInSetB])).toBe(true);
  });

  it("is not ambiguous when every result belongs to the same set", () => {
    expect(isAmbiguousNumberSearch({ number: "25" }, [cardInSetA, secondCardInSetA])).toBe(false);
  });

  it("is never ambiguous once a set filter narrows the search", () => {
    expect(isAmbiguousNumberSearch({ number: "25", setId: "set-a" }, [cardInSetA, cardInSetB])).toBe(false);
  });

  it("is never ambiguous for a name search, even across sets", () => {
    expect(isAmbiguousNumberSearch({ q: "charizard" }, [cardInSetA, cardInSetB])).toBe(false);
  });

  it("is not ambiguous when there is a single match", () => {
    expect(isAmbiguousNumberSearch({ number: "25" }, [cardInSetA])).toBe(false);
  });

  it("is never ambiguous once a set-name filter narrows the search", () => {
    expect(isAmbiguousNumberSearch({ number: "25", setName: "Base Set" }, [cardInSetA, cardInSetB])).toBe(false);
  });
});

describe("isNumberOnlySearch", () => {
  it("is true when only a number filter is present", () => {
    expect(isNumberOnlySearch({ number: "25" })).toBe(true);
  });

  it("is false when a name filter is also present", () => {
    expect(isNumberOnlySearch({ number: "25", q: "charizard" })).toBe(false);
  });

  it("is false when a set id filter is also present", () => {
    expect(isNumberOnlySearch({ number: "25", setId: "set-a" })).toBe(false);
  });

  it("is false when a set name filter is also present", () => {
    expect(isNumberOnlySearch({ number: "25", setName: "Base Set" })).toBe(false);
  });

  it("is false when no number is provided", () => {
    expect(isNumberOnlySearch({})).toBe(false);
  });
});

describe("countDistinctSets", () => {
  it("counts unique set ids", () => {
    expect(countDistinctSets([cardInSetA, secondCardInSetA, cardInSetB])).toBe(2);
  });

  it("returns zero for an empty list", () => {
    expect(countDistinctSets([])).toBe(0);
  });
});

describe("groupCandidatesBySet", () => {
  it("groups candidates while preserving first-seen set order", () => {
    const groups = groupCandidatesBySet([cardInSetB, cardInSetA, secondCardInSetA]);

    expect(groups).toEqual([
      { setId: "set-b", candidates: [cardInSetB] },
      { setId: "set-a", candidates: [cardInSetA, secondCardInSetA] }
    ]);
  });
});
