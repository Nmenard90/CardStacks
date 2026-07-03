/**
 * File: collection.repository.ts
 * Purpose:
 *   Contains database operations for user collection inventory.
 *
 * Why this file exists:
 *   Inventory writes must be consistent and ownership-safe. Keeping queries in
 *   one place prevents route handlers from becoming messy.
 */

import type { CardCondition, PrismaClient } from "@prisma/client";

export interface QuickAddInput {
  userId: string;
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
 * Finds a card variant and confirms it belongs to the requested card.
 */
export async function findVariantForCard(prisma: PrismaClient, cardId: string, variantId: string) {
  return prisma.cardVariant.findFirst({ where: { id: variantId, cardId } });
}

/**
 * Lists a user's collection with card and variant details.
 *
 * Performance:
 *   The query is scoped by indexed `userId` and returns only display fields.
 */
export async function listCollectionItems(prisma: PrismaClient, userId: string) {
  return prisma.collectionItem.findMany({
    where: { userId },
    orderBy: [{ updatedAt: "desc" }],
    include: {
      card: { select: { id: true, name: true, number: true, imageSmall: true, set: { select: { id: true, name: true } } } },
      variant: true
    }
  });
}

/**
 * Adds inventory or increments an existing matching inventory bucket.
 *
 * Data consistency:
 *   The unique key keeps one bucket per user/card/variant/condition/location.
 */
export async function quickAddCollectionItem(prisma: PrismaClient, input: QuickAddInput) {
  const storageLocation = input.storageLocation ?? "default";

  return prisma.$transaction(async (tx) => {
    const item = await tx.collectionItem.upsert({
      where: {
        userId_cardId_variantId_condition_storageLocation: {
          userId: input.userId,
          cardId: input.cardId,
          variantId: input.variantId,
          condition: input.condition,
          storageLocation
        }
      },
      update: { quantity: { increment: input.quantity }, notes: input.notes },
      create: {
        userId: input.userId,
        cardId: input.cardId,
        variantId: input.variantId,
        condition: input.condition,
        quantity: input.quantity,
        storageLocation,
        notes: input.notes
      }
    });

    if (input.pricePaidEach !== undefined || input.purchasedAt !== undefined) {
      await tx.purchaseLot.create({
        data: {
          userId: input.userId,
          cardId: input.cardId,
          variantId: input.variantId,
          condition: input.condition,
          quantity: input.quantity,
          pricePaidEach: input.pricePaidEach,
          pricePaidTotal: input.pricePaidEach === undefined ? undefined : input.pricePaidEach * input.quantity,
          purchasedAt: input.purchasedAt === undefined ? undefined : new Date(input.purchasedAt),
          seller: input.seller,
          notes: input.notes
        }
      });
    }

    return item;
  });
}

/**
 * Updates a collection item owned by a user.
 */
export async function updateOwnedCollectionItem(
  prisma: PrismaClient,
  userId: string,
  itemId: string,
  data: { quantity?: number; storageLocation?: string | null; notes?: string | null }
) {
  return prisma.collectionItem.update({
    where: { id: itemId, userId },
    data
  });
}

/**
 * Deletes a collection item owned by a user.
 */
export async function deleteOwnedCollectionItem(prisma: PrismaClient, userId: string, itemId: string) {
  return prisma.collectionItem.delete({ where: { id: itemId, userId } });
}

/**
 * Calculates collection totals in the database instead of in Node memory.
 */
export async function summarizeCollection(prisma: PrismaClient, userId: string) {
  const grouped = await prisma.collectionItem.groupBy({
    by: ["condition"],
    where: { userId },
    _sum: { quantity: true },
    _count: { id: true }
  });

  const totalQuantity = grouped.reduce((sum, row) => sum + (row._sum.quantity ?? 0), 0);
  const bucketCount = grouped.reduce((sum, row) => sum + row._count.id, 0);

  return { totalQuantity, bucketCount, byCondition: grouped };
}
