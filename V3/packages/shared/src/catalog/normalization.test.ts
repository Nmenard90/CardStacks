import { describe, expect, it } from "vitest";
import { normalizeCardName, parseCollectorNumberInt } from "./normalization.js";

describe("normalizeCardName", () => {
  it("lowercases and collapses internal whitespace", () => {
    expect(normalizeCardName("  Charizard   ex  ")).toBe("charizard ex");
  });

  it("is stable for already-normalized input", () => {
    expect(normalizeCardName("pikachu")).toBe("pikachu");
  });
});

describe("parseCollectorNumberInt", () => {
  it("parses purely numeric collector numbers", () => {
    expect(parseCollectorNumberInt("80")).toBe(80);
  });

  it("treats leading zeros as the same numeric value", () => {
    expect(parseCollectorNumberInt("080")).toBe(80);
  });

  it("returns null for alphanumeric collector numbers instead of coercing them", () => {
    expect(parseCollectorNumberInt("TG10")).toBeNull();
    expect(parseCollectorNumberInt("025a")).toBeNull();
  });

  it("returns null for empty input", () => {
    expect(parseCollectorNumberInt("")).toBeNull();
    expect(parseCollectorNumberInt("   ")).toBeNull();
  });
});
