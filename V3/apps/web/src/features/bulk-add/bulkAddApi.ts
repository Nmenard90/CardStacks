/**
 * File: bulkAddApi.ts
 * Purpose:
 *   Typed API calls used by the bulk-add workflow: collector-number lookup
 *   (set-scoped or ambiguous global), variant loading, and staged-batch
 *   save.
 *
 * Why this file exists:
 *   Bulk add reuses the existing catalog search contract (FR-BULK-001/002)
 *   instead of duplicating name/set/number query logic, and the existing
 *   collection bulk-add write path (FR-BULK-007) from
 *   `features/collection/collectionApi.ts`, matching the coding standard
 *   against duplicating domain normalization logic across features.
 */

import type { BulkAddRowInput, BulkAddRowResult } from "@tcg/shared";
import { apiGet } from "../../lib/api.js";
import { bulkAddToCollection } from "../collection/collectionApi.js";
import { searchCards, type SearchResultCard } from "../search/searchApi.js";

export type { SearchResultCard };

export interface CardVariantOption {
  id: string;
  displayName: string;
}

interface CardDetail extends SearchResultCard {
  variants: CardVariantOption[];
}

export interface NumberLookupResult {
  ambiguous: boolean;
  matches: SearchResultCard[];
  /**
   * True when the true match count exceeds `MAX_LOOKUP_MATCHES` and the
   * caller is showing a bounded prefix rather than every match. A number
   * search can legitimately span most of the catalog's sets (e.g. "1"), so
   * this must stay bounded rather than fetching an unbounded page count.
   */
  truncated: boolean;
}

const LOOKUP_PAGE_LIMIT = 50;
const MAX_LOOKUP_PAGES = 10;
export const MAX_LOOKUP_MATCHES = LOOKUP_PAGE_LIMIT * MAX_LOOKUP_PAGES;

/**
 * Looks up cards by collector number, optionally scoped to a set
 * (FR-BULK-001). When no set is given and the number matches more than one
 * set, the result is ambiguous; every candidate up to `MAX_LOOKUP_MATCHES`
 * is fetched (across pages) so the caller can group them by set without a
 * silent 50-row cutoff hiding real candidates (FR-BULK-002).
 */
export async function lookupCardsByNumber(number: string, setId?: string): Promise<NumberLookupResult> {
  const first = await searchCards({ number, setId, page: 1, limit: LOOKUP_PAGE_LIMIT });
  const matches = [...first.items];

  const totalPages = Math.min(first.pageInfo.totalPages, MAX_LOOKUP_PAGES);
  for (let page = 2; page <= totalPages; page += 1) {
    const next = await searchCards({ number, setId, page, limit: LOOKUP_PAGE_LIMIT });
    matches.push(...next.items);
  }

  return {
    ambiguous: first.ambiguous,
    matches,
    truncated: first.pageInfo.total > MAX_LOOKUP_MATCHES
  };
}

/**
 * Loads a card's variants so a staged row can offer a variant choice
 * (FR-BULK-006).
 */
export async function loadCardVariants(cardId: string): Promise<CardVariantOption[]> {
  const detail = await apiGet<CardDetail>(`/api/v1/cards/${cardId}`);
  return detail.variants;
}

export interface SaveBulkAddResult {
  results: BulkAddRowResult[];
  savedCount: number;
  failedCount: number;
}

/**
 * Saves a staged batch, returning per-row outcomes (FR-BULK-007) so the
 * caller can drop successful rows and keep failed rows staged for retry.
 */
export async function saveStagedRows(rows: BulkAddRowInput[]): Promise<SaveBulkAddResult> {
  return bulkAddToCollection(rows);
}
