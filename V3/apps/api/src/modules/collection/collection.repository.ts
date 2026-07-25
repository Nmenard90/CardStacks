/**
 * File: collection.repository.ts
 * Purpose:
 *   Contains database operations for user collection inventory.
 *
 * Why this file exists:
 *   Inventory writes must be consistent and ownership-safe. Keeping queries in
 *   one place prevents route handlers from becoming messy.
 */

import type { CardCondition, Prisma, PrismaClient } from "@prisma/client";
import {
  COLLECTION_QUANTITY_MAX,
  normalizeCardName,
  normalizeStorageLocation,
  parseCollectorNumberInt,
  type CollectionSortDirection,
  type CollectionSortField
} from "@tcg/shared";
import type { PageRequest } from "../catalog/catalog.repository.js";

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

export interface OwnedCollectionFilters {
  setId?: string;
  q?: string;
  number?: string;
  condition?: CardCondition;
  variantKey?: string;
  storageLocation?: string;
}

export interface OwnedCollectionSort {
  field: CollectionSortField;
  direction: CollectionSortDirection;
}

export interface UpdateCollectionItemData {
  condition?: CardCondition;
  quantity?: number;
  storageLocation?: string;
  notes?: string | null;
}

/**
 * Finds a card variant and confirms it belongs to the requested card.
 *
 * Reused by quick add and bulk add so cross-card variant submission
 * (COL-402) is rejected the same way everywhere.
 */
export async function findVariantForCard(prisma: PrismaClient, cardId: string, variantId: string) {
  return prisma.cardVariant.findFirst({ where: { id: variantId, cardId } });
}

/**
 * Lists a bounded, filtered, sorted page of a user's collection with card
 * and variant summary fields.
 *
 * Performance:
 *   The query is scoped by the indexed `userId` column plus, when supplied,
 *   the indexed `setId`/`normalizedName`/`number`/`numberInt` columns used by
 *   catalog search. It never loads the full collection into memory to filter
 *   or sort it in Node.
 *
 * Security:
 *   Uses an explicit `select` so internal ids (`userId`, `cardId`,
 *   `variantId`) and provider-only fields never reach the response DTO.
 */
export async function listOwnedCollectionItems(
  prisma: PrismaClient,
  userId: string,
  filters: OwnedCollectionFilters,
  pageRequest: PageRequest,
  sort: OwnedCollectionSort
) {
  const where = buildOwnedCollectionWhere(userId, filters);
  const orderBy = buildOwnedCollectionOrderBy(sort);
  const skip = (pageRequest.page - 1) * pageRequest.limit;

  const [items, total] = await Promise.all([
    prisma.collectionItem.findMany({
      where,
      orderBy,
      skip,
      take: pageRequest.limit,
      select: collectionItemSelect()
    }),
    prisma.collectionItem.count({ where })
  ]);

  return { items, total };
}

/**
 * Adds inventory or increments an existing matching inventory bucket.
 *
 * Data consistency:
 *   The unique key keeps one bucket per user/card/variant/condition/location,
 *   and every writer normalizes the storage location through the same
 *   canonical helper (COL-401) so blank/missing storage never splits into a
 *   duplicate bucket.
 */
export async function quickAddCollectionItem(prisma: PrismaClient, input: QuickAddInput) {
  const storageLocation = normalizeStorageLocation(input.storageLocation);

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
      update: { quantity: { increment: input.quantity }, ...(input.notes !== undefined ? { notes: input.notes } : {}) },
      create: {
        userId: input.userId,
        cardId: input.cardId,
        variantId: input.variantId,
        condition: input.condition,
        quantity: input.quantity,
        storageLocation,
        notes: input.notes
      },
      select: collectionItemSelect()
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
 *
 * Uses Prisma's extended unique-where (`id` + `userId`) so a mismatched
 * owner throws the same not-found (P2025) as a genuinely missing id,
 * matching the ownership-privacy rule in security.md.
 */
export async function updateOwnedCollectionItem(prisma: PrismaClient, userId: string, itemId: string, data: UpdateCollectionItemData) {
  return prisma.collectionItem.update({
    where: { id: itemId, userId },
    data,
    select: collectionItemSelect()
  });
}

/**
 * Deletes a collection item owned by a user.
 */
export async function deleteOwnedCollectionItem(prisma: PrismaClient, userId: string, itemId: string) {
  return prisma.collectionItem.delete({ where: { id: itemId, userId }, select: { id: true } });
}

/**
 * Result of an increment/decrement quantity adjustment.
 *
 * `invalid` covers boundary violations (decrementing past zero minus what
 * exists, or incrementing past the collection quantity ceiling) so the
 * service can map them to a 400 without a second round trip.
 */
export type AdjustQuantityOutcome =
  | { status: "updated"; item: Awaited<ReturnType<typeof updateOwnedCollectionItem>> }
  | { status: "deleted" }
  | { status: "not_found" }
  | { status: "invalid"; message: string };

/**
 * Applies a bounded increment/decrement to a collection item's quantity in
 * one transaction, deleting the bucket when the result reaches zero.
 *
 * Why a transaction:
 *   Increment/decrement must read-then-write atomically so two concurrent
 *   decrements cannot both pass a boundary check against the same stale
 *   quantity and drive the bucket negative.
 */
export async function adjustCollectionItemQuantity(prisma: PrismaClient, userId: string, itemId: string, delta: number): Promise<AdjustQuantityOutcome> {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.collectionItem.findFirst({ where: { id: itemId, userId } });

    if (!existing) {
      return { status: "not_found" };
    }

    const nextQuantity = existing.quantity + delta;

    if (nextQuantity < 0) {
      return {
        status: "invalid",
        message: `Cannot decrease quantity by ${Math.abs(delta)}; this bucket only has ${existing.quantity}.`
      };
    }

    if (nextQuantity > COLLECTION_QUANTITY_MAX) {
      return { status: "invalid", message: `Quantity cannot exceed ${COLLECTION_QUANTITY_MAX}.` };
    }

    if (nextQuantity === 0) {
      await tx.collectionItem.delete({ where: { id: itemId } });
      return { status: "deleted" };
    }

    const item = await tx.collectionItem.update({
      where: { id: itemId },
      data: { quantity: nextQuantity },
      select: collectionItemSelect()
    });

    return { status: "updated", item };
  });
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

/**
 * Provides the public collection item fields returned by owned-collection
 * routes: never the raw `userId`/`cardId`/`variantId` foreign keys, and
 * never card/variant provider-internal fields (source SKU/product ids).
 */
function collectionItemSelect() {
  return {
    id: true,
    condition: true,
    quantity: true,
    storageLocation: true,
    notes: true,
    createdAt: true,
    updatedAt: true,
    card: {
      select: {
        id: true,
        name: true,
        number: true,
        imageSmall: true,
        set: { select: { id: true, name: true } }
      }
    },
    variant: {
      select: {
        id: true,
        variantKey: true,
        displayName: true,
        finish: true,
        edition: true,
        language: true
      }
    }
  } as const;
}

/**
 * Builds the Prisma `where` clause for the owned-collection list, always
 * scoped to `userId` first (FR-COL-001).
 *
 * Number matching mirrors the catalog search rule: purely numeric numbers
 * also match `numberInt` (leading-zero tolerant); alphanumeric numbers match
 * `number` exactly (FR-COL-002/FR-CAT-006).
 */
function buildOwnedCollectionWhere(userId: string, filters: OwnedCollectionFilters): Prisma.CollectionItemWhereInput {
  const conditions: Prisma.CollectionItemWhereInput[] = [{ userId }];

  if (filters.setId) {
    conditions.push({ card: { setId: filters.setId } });
  }

  if (filters.q) {
    conditions.push({ card: { normalizedName: { startsWith: normalizeCardName(filters.q) } } });
  }

  if (filters.number) {
    const numberInt = parseCollectorNumberInt(filters.number);
    conditions.push({
      card: { OR: numberInt === null ? [{ number: filters.number }] : [{ number: filters.number }, { numberInt }] }
    });
  }

  if (filters.condition) {
    conditions.push({ condition: filters.condition });
  }

  if (filters.variantKey) {
    conditions.push({ variant: { variantKey: filters.variantKey } });
  }

  if (filters.storageLocation) {
    conditions.push({ storageLocation: normalizeStorageLocation(filters.storageLocation) });
  }

  return { AND: conditions };
}

/**
 * Builds the Prisma `orderBy` clause for the owned-collection list from a
 * validated sort field (see `@tcg/shared` `COLLECTION_SORT_FIELDS`).
 */
function buildOwnedCollectionOrderBy(sort: OwnedCollectionSort): Prisma.CollectionItemOrderByWithRelationInput[] {
  switch (sort.field) {
    case "name":
      return [{ card: { name: sort.direction } }];
    case "number":
      return [{ card: { numberInt: sort.direction } }, { card: { number: sort.direction } }];
    case "quantity":
      return [{ quantity: sort.direction }];
    case "condition":
      return [{ condition: sort.direction }];
    case "updatedAt":
    default:
      return [{ updatedAt: sort.direction }];
  }
}
