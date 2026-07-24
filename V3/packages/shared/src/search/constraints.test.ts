import { describe, expect, it } from "vitest";
import { hasMeaningfulSearchFilter } from "./constraints.js";

describe("hasMeaningfulSearchFilter", () => {
  it("is false when no filter is provided", () => {
    expect(hasMeaningfulSearchFilter({})).toBe(false);
  });

  it("is false when every filter is whitespace-only", () => {
    expect(hasMeaningfulSearchFilter({ q: "  ", setId: "  ", setName: "  ", number: "  " })).toBe(false);
  });

  it("is true when only a name filter is provided", () => {
    expect(hasMeaningfulSearchFilter({ q: "Charizard" })).toBe(true);
  });

  it("is true when only a set id filter is provided", () => {
    expect(hasMeaningfulSearchFilter({ setId: "sv1" })).toBe(true);
  });

  it("is true when only a set name filter is provided", () => {
    expect(hasMeaningfulSearchFilter({ setName: "Scarlet" })).toBe(true);
  });

  it("is true when only a number filter is provided", () => {
    expect(hasMeaningfulSearchFilter({ number: "080" })).toBe(true);
  });
});
