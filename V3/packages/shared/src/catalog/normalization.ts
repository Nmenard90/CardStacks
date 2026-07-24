/**
 * File: normalization.ts
 * Purpose:
 *   Normalizes card names and collector numbers the same way everywhere
 *   catalog data is written or searched.
 *
 * Why this file exists:
 *   Search, catalog sync, and display must agree on what counts as a
 *   name/number match. Duplicating this logic per app risks silent drift.
 */

/**
 * Normalizes a card name for case/spacing-insensitive comparison and storage.
 */
export function normalizeCardName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Parses a collector number into an integer only when it is purely numeric.
 *
 * Collector numbers are not globally unique, and alphanumeric numbers (e.g.
 * "TG10", "025a") must never be coerced into a numeric comparison. Leading
 * zeros only matter for purely numeric values ("080" should match "80").
 */
export function parseCollectorNumberInt(number: string): number | null {
  const trimmed = number.trim();
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
}
