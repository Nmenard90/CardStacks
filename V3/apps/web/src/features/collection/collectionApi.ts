/**
 * File: collectionApi.ts
 * Purpose:
 *   Typed API calls for the owned-collection view and collection item
 *   writes (add, update, quantity adjust, remove, bulk add).
 *
 * Why this file exists:
 *   Keeping query-string construction and response typing in one place
 *   avoids each collection UI re-deriving the request shape, and matches the
 *   convention already used by `features/search/searchApi.ts`.
 */

import type { BulkAddRowInput, BulkAddRowResult, CardCondition, CollectionSortDirection, CollectionSortField, PageInfo } from "@tcg/shared";
import { apiGet, apiSend } from "../../lib/api.js";

export interface OwnedCollectionItem {
  id: string;
  condition: CardCondition;
  quantity: number;
  storageLocation: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
  card: { id: string; name: string; number: string; imageSmall?: string; set: { id: string; name: string } };
  variant: { id: string; variantKey: string; displayName: string; finish?: string | null; edition?: string | null; language: string };
}

export interface OwnedCollectionResult {
  items: OwnedCollectionItem[];
  pageInfo: PageInfo;
}

export interface OwnedCollectionParams {
  page: number;
  limit: number;
  sort: CollectionSortField;
  direction: CollectionSortDirection;
  setId?: string;
  q?: string;
  number?: string;
  condition?: CardCondition;
  variantKey?: string;
  storageLocation?: string;
}

/**
 * Lists a bounded, filtered, sorted page of the signed-in user's collection.
 */
export async function listOwnedCollection(params: OwnedCollectionParams): Promise<OwnedCollectionResult> {
  const query = new URLSearchParams({
    page: String(params.page),
    limit: String(params.limit),
    sort: params.sort,
    direction: params.direction
  });

  if (params.setId) query.set("setId", params.setId);
  if (params.q) query.set("q", params.q);
  if (params.number) query.set("number", params.number);
  if (params.condition) query.set("condition", params.condition);
  if (params.variantKey) query.set("variantKey", params.variantKey);
  if (params.storageLocation) query.set("storageLocation", params.storageLocation);

  return apiGet<OwnedCollectionResult>(`/api/v1/collection?${query}`);
}

export interface AddToCollectionInput {
  cardId: string;
  variantId: string;
  condition: CardCondition;
  quantity: number;
  storageLocation?: string;
  pricePaidEach?: number;
  purchasedAt?: string;
  seller?: string;
  notes?: string;
}

/**
 * Adds a card to the collection with default OR fully explicit detail
 * (FR-COL-003/004/012) — both quick add and explicit add share this call.
 */
export async function addToCollection(input: AddToCollectionInput): Promise<OwnedCollectionItem> {
  return apiSend<OwnedCollectionItem>("/api/v1/collection/quick-add", "POST", input);
}

export interface UpdateCollectionItemInput {
  condition?: CardCondition;
  quantity?: number;
  storageLocation?: string | null;
  notes?: string | null;
}

export type CollectionWriteResult = OwnedCollectionItem | { deleted: true };

/**
 * Updates a collection item's condition, quantity, storage, or notes.
 * Setting `quantity` to 0 removes the bucket (see API service docs).
 */
export async function updateCollectionItem(itemId: string, input: UpdateCollectionItemInput): Promise<CollectionWriteResult> {
  return apiSend<CollectionWriteResult>(`/api/v1/collection/items/${itemId}`, "PATCH", input);
}

/**
 * Applies a bounded increment (positive) or decrement (negative) to a
 * collection item's quantity. A decrement that reaches zero removes the
 * bucket automatically.
 */
export async function adjustCollectionQuantity(itemId: string, delta: number): Promise<CollectionWriteResult> {
  return apiSend<CollectionWriteResult>(`/api/v1/collection/items/${itemId}/quantity-delta`, "POST", { delta });
}

/**
 * Removes a collection item completely.
 */
export async function removeCollectionItem(itemId: string): Promise<{ id: string }> {
  return apiSend<{ id: string }>(`/api/v1/collection/items/${itemId}`, "DELETE");
}

export interface BulkAddResponse {
  results: BulkAddRowResult[];
  savedCount: number;
  failedCount: number;
}

/**
 * Saves a staged batch of bulk-add rows and returns a per-row outcome
 * (FR-BULK-007) so the caller can keep failed rows staged for retry.
 */
export async function bulkAddToCollection(rows: BulkAddRowInput[]): Promise<BulkAddResponse> {
  return apiSend<BulkAddResponse>("/api/v1/collection/bulk-add", "POST", { rows });
}
