/**
 * File: bulkAdd.ts
 * Purpose:
 *   Defines the staged-row contract shared by the bulk-add API and web
 *   feature.
 *
 * Why this file exists:
 *   Bulk add must report success/failure per row, not just a global result
 *   (FR-BULK-007). The API and web client need the same row shape and the
 *   same bound on batch size so a save request can never grow unbounded.
 */

import type { CardCondition } from "../conditions.js";

/** Upper bound on rows per bulk-add save request (FR-BULK-005 keyboard entry stays well under this). */
export const BULK_ADD_MAX_ROWS = 100;

export interface BulkAddRowInput {
  cardId: string;
  variantId: string;
  condition: CardCondition;
  quantity: number;
  storageLocation?: string;
  notes?: string;
}

export interface BulkAddRowResult {
  index: number;
  ok: boolean;
  itemId?: string;
  error?: { code: string; message: string };
}

export interface BulkAddResult {
  results: BulkAddRowResult[];
  savedCount: number;
  failedCount: number;
}
