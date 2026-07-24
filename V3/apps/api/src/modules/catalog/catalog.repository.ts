/**
 * File: catalog.repository.ts
 * Purpose:
 *   Contains database queries for browsing Pokémon sets, cards, and variants.
 *
 * Why this file exists:
 *   Keeping database access out of routes makes the API easier to test,
 *   optimize, and reuse from workers. Card *search* (name/set/number
 *   filtering) lives in the sibling `search` module; this module only
 *   handles bounded browsing and single-record detail lookups.
 */

import type { PrismaClient } from "@prisma/client";

export interface PageRequest {
  page: number;
  limit: number;
}

/**
 * Lists Pokémon sets in release order, bounded by page/limit.
 *
 * Performance:
 *   The catalog holds a bounded number of sets (roughly 150), so a full
 *   count alongside a paginated page is inexpensive.
 */
export async function listSets(prisma: PrismaClient, { page, limit }: PageRequest) {
  const [items, total] = await Promise.all([
    prisma.set.findMany({
      orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: setSelect()
    }),
    prisma.set.count()
  ]);

  return { items, total };
}

/**
 * Finds one set by id.
 */
export async function findSetById(prisma: PrismaClient, setId: string) {
  return prisma.set.findUnique({
    where: { id: setId },
    select: setSelect()
  });
}

/**
 * Lists cards for a set with stable collector-number ordering, bounded by
 * page/limit.
 *
 * Performance:
 *   This query is scoped by the indexed `setId` column and paginated by the
 *   caller, so it never loads an entire set's cards into memory at once.
 */
export async function listCardsBySet(prisma: PrismaClient, setId: string, { page, limit }: PageRequest) {
  const where = { setId };

  const [items, total] = await Promise.all([
    prisma.card.findMany({
      where,
      orderBy: [{ numberInt: "asc" }, { number: "asc" }, { name: "asc" }],
      skip: (page - 1) * limit,
      take: limit,
      select: cardListSelect()
    }),
    prisma.card.count({ where })
  ]);

  return { items, total };
}

/**
 * Finds one card with its set and variants for the card detail view.
 *
 * Security:
 *   Uses explicit `select` on every level so provider raw JSON and internal
 *   source identifiers never reach a public response (FR-CAT-010).
 */
export async function findCardDetail(prisma: PrismaClient, cardId: string) {
  return prisma.card.findUnique({
    where: { id: cardId },
    select: {
      ...cardListSelect(),
      artist: true,
      supertype: true,
      subtypes: true,
      variants: {
        orderBy: { displayName: "asc" },
        select: variantSelect()
      }
    }
  });
}

/**
 * Provides the public set fields returned by catalog routes.
 */
function setSelect() {
  return {
    id: true,
    name: true,
    series: true,
    printedTotal: true,
    total: true,
    releaseDate: true,
    symbolUrl: true,
    logoUrl: true
  } as const;
}

/**
 * Provides the public card fields returned by list/search/detail routes.
 */
function cardListSelect() {
  return {
    id: true,
    setId: true,
    name: true,
    number: true,
    rarity: true,
    imageSmall: true,
    imageLarge: true,
    set: { select: { id: true, name: true, series: true } }
  } as const;
}

/**
 * Provides the public variant fields returned by card detail/variant routes.
 *
 * `sourceProductId`/`sourceSkuId` are internal provider identifiers and are
 * intentionally excluded from the public contract.
 */
function variantSelect() {
  return {
    id: true,
    variantKey: true,
    displayName: true,
    finish: true,
    edition: true,
    language: true,
    isMasterSetVariant: true
  } as const;
}
