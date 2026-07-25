/**
 * File: storage.ts
 * Purpose:
 *   Defines the single canonical representation for "no storage location
 *   specified" used by every collection write path.
 *
 * Why this file exists:
 *   The collection bucket uniqueness key includes `storageLocation`. If
 *   quick add, explicit add, updates, bulk add, and imports each picked a
 *   different stand-in for "unspecified" (null vs "" vs "default"), the same
 *   physical pile of cards could silently split into duplicate buckets
 *   (COL-401). Every writer must normalize through this function.
 */

export const DEFAULT_STORAGE_LOCATION = "default";

/**
 * Normalizes a user-supplied storage location to the canonical form.
 *
 * Blank, whitespace-only, null, and undefined all collapse to
 * `DEFAULT_STORAGE_LOCATION`; any other value is trimmed and returned as-is.
 */
export function normalizeStorageLocation(value: string | null | undefined): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : DEFAULT_STORAGE_LOCATION;
}
