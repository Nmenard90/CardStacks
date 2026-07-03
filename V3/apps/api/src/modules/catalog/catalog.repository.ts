/**
 * File: catalog.repository.ts
 * Purpose:
 *   Contains database queries for Pokémon sets, cards, and variants.
 *
 * Why this file exists:
 *   Keeping database access out of routes makes the API easier to test,
 *   optimize, and reuse from workers.
 */

import type { PrismaClient } from "@prisma/client";

export interface CardSearchInput {
  q?: string;
  setId?: string;
  number?: string;
  page: number;
  limit: number;
}

/**
 * Normalizes names for predictable case-insensitive search.
 */
export function normalizeCardName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Converts a collector number to an integer only when it is purely numeric.
 */
export function parseCardNumberInt(number: string): number | null {
  return /^\d+$/.test(number) ? Number.parseInt(number, 10) : null;
}

/**
 * Lists Pokémon sets in release order.
 */
export async function listSets(prisma: PrismaClient) {
  return prisma.set.findMany({
    orderBy: [{ releaseDate: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      series: true,
      printedTotal: true,
      total: true,
      releaseDate: true,
      symbolUrl: true,
      logoUrl: true
    }
  });
}

/**
 * Finds one set by id.
 */
export async function findSetById(prisma: PrismaClient, setId: string) {
  return prisma.set.findUnique({
    where: { id: setId },
    select: {
      id: true,
      name: true,
      series: true,
      printedTotal: true,
      total: true,
      releaseDate: true,
      symbolUrl: true,
      logoUrl: true
    }
  });
}

/**
 * Lists cards for a set with stable collector-number ordering.
 *
 * Performance:
 *   This query is scoped by indexed `setId` and paginated by the caller.
 */
export async function listCardsBySet(prisma: PrismaClient, setId: string) {
  return prisma.card.findMany({
    where: { setId },
    orderBy: [{ numberInt: "asc" }, { number: "asc" }, { name: "asc" }],
    select: cardListSelect()
  });
}

/**
 * Searches cards by name, set, and/or collector number.
 *
 * Performance:
 *   Uses indexed fields and pagination. It never loads the full catalog into
 *   Node memory to filter it.
 */
export async function searchCards(prisma: PrismaClient, input: CardSearchInput) {
  const numberInt = input.number ? parseCardNumberInt(input.number) : null;
  const skip = (input.page - 1) * input.limit;

  return prisma.card.findMany({
    where: {
      AND: [
        input.q ? { normalizedName: { contains: normalizeCardName(input.q) } } : {},
        input.setId ? { setId: input.setId } : {},
        input.number
          ? {
              OR: [
                { number: input.number },
                numberInt === null ? {} : { numberInt }
              ]
            }
          : {}
      ]
    },
    orderBy: [{ name: "asc" }, { setId: "asc" }, { numberInt: "asc" }, { number: "asc" }],
    skip,
    take: input.limit,
    select: cardListSelect()
  });
}

/**
 * Finds one card with variants.
 */
export async function findCardDetail(prisma: PrismaClient, cardId: string) {
  return prisma.card.findUnique({
    where: { id: cardId },
    include: {
      set: {
        select: { id: true, name: true, series: true }
      },
      variants: {
        orderBy: { displayName: "asc" }
      }
    }
  });
}

/**
 * Provides the card fields returned by list/search routes.
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
  };
}
