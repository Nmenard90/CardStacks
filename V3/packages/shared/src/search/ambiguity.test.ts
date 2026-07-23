import { describe, expect, it } from "vitest";
import { countDistinctSets, groupCandidatesBySet, isAmbiguousNumberSearch } from "./ambiguity.js";

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
