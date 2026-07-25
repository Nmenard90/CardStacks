/**
 * File: collection.service.ts
 * Purpose:
 *   Holds collection business rules: quick add, explicit add, bulk add,
 *   quantity adjustment, updates, removal, and the owned-collection view.
 *
 * Why this file exists:
 *   Adding a card is more than an insert. We must validate card/variant
 *   relationships, record purchase information safely, and map database
 *   conflicts/not-found conditions to the correct HTTP-facing error
 *   (COL-403) instead of collapsing every failure into "not found".
 */

import { Prisma, type PrismaClient } from "@prisma/client";
import { buildPageInfo, normalizeStorageLocation, type BulkAddRowInput, type BulkAddRowResult, type PaginatedResult } from "@tcg/shared";
import { conflictError, notFoundError, validationError } from "../../errors/app-error.js";
import type { OwnedCollectionQuery } from "./collection.schemas.js";
import {
  adjustCollectionItemQuantity,
  deleteOwnedCollectionItem,
  findVariantForCard,
  listOwnedCollectionItems,
  quickAddCollectionItem,
  summarizeCollection,
  updateOwnedCollectionItem,
  type QuickAddInput,
  type UpdateCollectionItemData
} from "./collection.repository.js";

type OwnedCollectionItem = Awaited<ReturnType<typeof listOwnedCollectionItems>>["items"][number];

/**
 * Returns a bounded, filtered, sorted page of a user's collection.
 */
export async function getOwnedCollection(prisma: PrismaClient, userId: string, query: OwnedCollectionQuery): Promise<PaginatedResult<OwnedCollectionItem>> {
  const { page, limit, sort, direction, ...filters } = query;
  const { items, total } = await listOwnedCollectionItems(prisma, userId, filters, { page, limit }, { field: sort, direction });
  return { items, pageInfo: buildPageInfo(page, limit, total) };
}

/**
 * Adds a card to a user's collection after validating variant ownership.
 *
 * Covers both "default quick add" (only cardId/variantId/condition/quantity
 * supplied) and explicit entry (storage/notes/paid price/purchase date
 * supplied) — they are the same write path with different optional fields
 * (FR-COL-003/004/012).
 */
export async function quickAddToCollection(prisma: PrismaClient, input: QuickAddInput) {
  await assertVariantBelongsToCard(prisma, input.cardId, input.variantId);
  return quickAddCollectionItem(prisma, input);
}

/**
 * Updates a user's collection item (condition, quantity, storage, notes).
 *
 * Setting `quantity` to 0 removes the bucket entirely, matching the
 * long-standing quick-edit convention: a user zeroing out a quantity field
 * means "I don't own this anymore," not "leave an empty bucket behind."
 */
export async function updateCollectionItem(
  prisma: PrismaClient,
  userId: string,
  itemId: string,
  input: { condition?: string; quantity?: number; storageLocation?: string | null; notes?: string | null }
) {
  if (input.quantity === 0) {
    try {
      await deleteOwnedCollectionItem(prisma, userId, itemId);
      return { deleted: true as const };
    } catch (error) {
      throw toCollectionWriteError(error, itemId);
    }
  }

  const data: UpdateCollectionItemData = {};
  if (input.condition !== undefined) data.condition = input.condition as UpdateCollectionItemData["condition"];
  if (input.quantity !== undefined) data.quantity = input.quantity;
  if (input.storageLocation !== undefined) data.storageLocation = normalizeStorageLocation(input.storageLocation);
  if (input.notes !== undefined) data.notes = input.notes;

  try {
    return await updateOwnedCollectionItem(prisma, userId, itemId, data);
  } catch (error) {
    throw toCollectionWriteError(error, itemId);
  }
}

/**
 * Applies a bounded increment/decrement to a collection item's quantity,
 * removing the bucket when the result reaches zero (safe decrement-to-zero
 * removal).
 */
export async function adjustCollectionQuantity(prisma: PrismaClient, userId: string, itemId: string, delta: number) {
  const outcome = await adjustCollectionItemQuantity(prisma, userId, itemId, delta);

  switch (outcome.status) {
    case "not_found":
      throw notFoundError("Collection item was not found for this user.", { itemId });
    case "invalid":
      throw validationError(outcome.message, { itemId, delta });
    case "deleted":
      return { deleted: true as const };
    case "updated":
      return outcome.item;
  }
}

/**
 * Removes a user's collection item completely.
 */
export async function removeCollectionItem(prisma: PrismaClient, userId: string, itemId: string) {
  try {
    return await deleteOwnedCollectionItem(prisma, userId, itemId);
  } catch (error) {
    throw toCollectionWriteError(error, itemId);
  }
}

/**
 * Returns safe collection summary counts.
 */
export async function getCollectionSummary(prisma: PrismaClient, userId: string) {
  return summarizeCollection(prisma, userId);
}

/**
 * Saves a staged batch of bulk-add rows, one at a time, returning a
 * per-row success/failure outcome instead of failing the whole batch
 * (FR-BULK-007). A bad row (unknown card, cross-card variant, database
 * conflict) never rolls back rows that already succeeded.
 */
export async function bulkAddToCollection(prisma: PrismaClient, userId: string, rows: BulkAddRowInput[]): Promise<{ results: BulkAddRowResult[]; savedCount: number; failedCount: number }> {
  const results: BulkAddRowResult[] = [];

  for (const [index, row] of rows.entries()) {
    try {
      await assertVariantBelongsToCard(prisma, row.cardId, row.variantId);

      const item = await quickAddCollectionItem(prisma, {
        userId,
        cardId: row.cardId,
        variantId: row.variantId,
        condition: row.condition as QuickAddInput["condition"],
        quantity: row.quantity,
        storageLocation: row.storageLocation,
        notes: row.notes
      });

      results.push({ index, ok: true, itemId: item.id });
    } catch (error) {
      results.push({ index, ok: false, error: bulkRowError(error) });
    }
  }

  const savedCount = results.filter((result) => result.ok).length;
  return { results, savedCount, failedCount: results.length - savedCount };
}

/**
 * Confirms a variant actually belongs to the submitted card before any
 * write (FR-COL-007/COL-402) — the single validation path shared by quick
 * add, explicit add, and bulk add.
 */
async function assertVariantBelongsToCard(prisma: PrismaClient, cardId: string, variantId: string): Promise<void> {
  const variant = await findVariantForCard(prisma, cardId, variantId);

  if (!variant) {
    throw validationError("Variant does not belong to the selected card.", { cardId, variantId });
  }
}

/**
 * Maps a bulk-add row failure to a user-safe, non-leaking error summary.
 */
function bulkRowError(error: unknown): { code: string; message: string } {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    return { code: "CONFLICT", message: "Another bucket already uses this card, variant, condition, and storage location." };
  }

  if (error && typeof error === "object" && "code" in error && "message" in error) {
    const appError = error as { code: unknown; message: unknown };
    if (typeof appError.code === "string" && typeof appError.message === "string") {
      return { code: appError.code, message: appError.message };
    }
  }

  return { code: "INTERNAL_ERROR", message: "This row could not be saved." };
}

/**
 * Maps a thrown Prisma error to the correct user-facing AppError (COL-403):
 * P2025 (record not found, including a mismatched owner via the
 * `id + userId` extended where) becomes 404; P2002 (unique constraint)
 * becomes 409. Any other error is rethrown unchanged so the global error
 * handler logs it and returns a generic 500 instead of a misleading 404.
 */
function toCollectionWriteError(error: unknown, itemId: string): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2025") {
      return notFoundError("Collection item was not found for this user.", { itemId });
    }

    if (error.code === "P2002") {
      return conflictError("Another collection bucket already uses this card, variant, condition, and storage location.", { itemId });
    }
  }

  return error;
}
