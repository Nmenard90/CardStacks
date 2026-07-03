/**
 * File: collection.service.ts
 * Purpose:
 *   Holds collection business rules.
 *
 * Why this file exists:
 *   Adding a card is more than an insert. We must validate card/variant
 *   relationships and record purchase information safely.
 */

import type { PrismaClient } from "@prisma/client";
import { notFoundError, validationError } from "../../errors/app-error.js";
import { deleteOwnedCollectionItem, findVariantForCard, listCollectionItems, quickAddCollectionItem, summarizeCollection, updateOwnedCollectionItem, type QuickAddInput } from "./collection.repository.js";

/**
 * Returns all collection items for a user.
 */
export async function getCollection(prisma: PrismaClient, userId: string) {
  return listCollectionItems(prisma, userId);
}

/**
 * Adds a card to a user's collection after validating variant ownership.
 */
export async function quickAddToCollection(prisma: PrismaClient, input: QuickAddInput) {
  const variant = await findVariantForCard(prisma, input.cardId, input.variantId);

  if (!variant) {
    throw validationError("Variant does not belong to the selected card.", {
      cardId: input.cardId,
      variantId: input.variantId
    });
  }

  return quickAddCollectionItem(prisma, input);
}

/**
 * Updates a user's collection item.
 */
export async function updateCollectionItem(prisma: PrismaClient, userId: string, itemId: string, data: { quantity?: number; storageLocation?: string | null; notes?: string | null }) {
  try {
    if (data.quantity === 0) {
      await deleteOwnedCollectionItem(prisma, userId, itemId);
      return { deleted: true };
    }

    return updateOwnedCollectionItem(prisma, userId, itemId, data);
  } catch {
    throw notFoundError("Collection item was not found for this user.", { itemId });
  }
}

/**
 * Removes a user's collection item completely.
 */
export async function removeCollectionItem(prisma: PrismaClient, userId: string, itemId: string) {
  try {
    return await deleteOwnedCollectionItem(prisma, userId, itemId);
  } catch {
    throw notFoundError("Collection item was not found for this user.", { itemId });
  }
}

/**
 * Returns safe collection summary counts.
 */
export async function getCollectionSummary(prisma: PrismaClient, userId: string) {
  return summarizeCollection(prisma, userId);
}
