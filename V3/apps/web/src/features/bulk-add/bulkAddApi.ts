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
}

/**
 * Looks up cards by collector number, optionally scoped to a set
 * (FR-BULK-001). When no set is given and the number matches more than one
 * set, the result is ambiguous and every candidate is returned so the
 * caller can group them by set (FR-BULK-002).
 */
export async function lookupCardsByNumber(number: string, setId?: string): Promise<NumberLookupResult> {
  const result = await searchCards({ number, setId, page: 1, limit: 50 });
  return { ambiguous: result.ambiguous, matches: result.items };
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
