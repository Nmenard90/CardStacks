/**
 * File: catalog.service.ts
 * Purpose:
 *   Holds catalog browsing business logic (sets, cards-in-set, card detail).
 *
 * Why this file exists:
 *   Routes should stay thin. Services decide what missing or unexpected data
 *   means for the app and shape bounded, paginated results.
 */

import type { PrismaClient } from "@prisma/client";
import { buildPageInfo, type PaginatedResult } from "@tcg/shared";
import { notFoundError } from "../../errors/app-error.js";
import { findCardDetail, findSetById, listCardsBySet, listSets, type PageRequest } from "./catalog.repository.js";

/**
 * Returns a bounded, paginated page of sets.
 */
export async function getSets(prisma: PrismaClient, pageRequest: PageRequest): Promise<PaginatedResult<Awaited<ReturnType<typeof findSetById>>>> {
  const { items, total } = await listSets(prisma, pageRequest);
  return { items, pageInfo: buildPageInfo(pageRequest.page, pageRequest.limit, total) };
}

/**
 * Returns one set or throws a user-safe not-found error.
 */
export async function getSet(prisma: PrismaClient, setId: string) {
  const set = await findSetById(prisma, setId);

  if (!set) {
    throw notFoundError("No Pokémon set was found for that id.", { setId });
  }

  return set;
}

/**
 * Returns a bounded, paginated page of cards for a set after confirming the
 * set exists.
 */
export async function getCardsForSet(prisma: PrismaClient, setId: string, pageRequest: PageRequest) {
  await getSet(prisma, setId);
  const { items, total } = await listCardsBySet(prisma, setId, pageRequest);
  return { items, pageInfo: buildPageInfo(pageRequest.page, pageRequest.limit, total) };
}

/**
 * Returns one card with variants or throws a user-safe not-found error.
 */
export async function getCardDetail(prisma: PrismaClient, cardId: string) {
  const card = await findCardDetail(prisma, cardId);

  if (!card) {
    throw notFoundError("No Pokémon card was found for that id.", { cardId });
  }

  return card;
}
