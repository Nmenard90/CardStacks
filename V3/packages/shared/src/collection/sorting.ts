/**
 * File: sorting.ts
 * Purpose:
 *   Defines the sortable fields for the owned-collection view.
 *
 * Why this file exists:
 *   The API validates the `sort`/`direction` query against this exact list
 *   and the web client builds its sort control from the same list, so the
 *   two can never drift (FR-COL-002).
 */

export const COLLECTION_SORT_FIELDS = ["updatedAt", "name", "number", "quantity", "condition"] as const;
export type CollectionSortField = (typeof COLLECTION_SORT_FIELDS)[number];

export const COLLECTION_SORT_DIRECTIONS = ["asc", "desc"] as const;
export type CollectionSortDirection = (typeof COLLECTION_SORT_DIRECTIONS)[number];
