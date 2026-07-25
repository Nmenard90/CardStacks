import { describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_LOCATION, normalizeStorageLocation } from "./storage.js";

describe("normalizeStorageLocation", () => {
  it("returns the canonical default for undefined", () => {
    expect(normalizeStorageLocation(undefined)).toBe(DEFAULT_STORAGE_LOCATION);
  });

  it("returns the canonical default for null", () => {
    expect(normalizeStorageLocation(null)).toBe(DEFAULT_STORAGE_LOCATION);
  });

  it("returns the canonical default for an empty string", () => {
    expect(normalizeStorageLocation("")).toBe(DEFAULT_STORAGE_LOCATION);
  });

  it("returns the canonical default for whitespace-only input", () => {
    expect(normalizeStorageLocation("   ")).toBe(DEFAULT_STORAGE_LOCATION);
  });

  it("trims and preserves a real storage location", () => {
    expect(normalizeStorageLocation("  Binder 3, Page 2  ")).toBe("Binder 3, Page 2");
  });
});
