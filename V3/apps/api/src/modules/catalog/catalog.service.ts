/**
 * File: catalog.service.ts
 * Purpose:
 *   Holds catalog business logic.
 *
 * Why this file exists:
 *   Routes should stay thin. Services decide what missing or unexpected data
 *   means for the app.
 */

import type { PrismaClient } from "@prisma/client";
import { notFoundError } from "../../errors/app-error.js";
import { findCardDetail, findSetById, listCardsBySet, listSets, searchCards, type CardSearchInput } from "./catalog.repository.js";

/**
 * Returns all sets.
 */
export async function getSets(prisma: PrismaClient) {
  return listSets(prisma);
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
 * Returns cards for a set after confirming the set exists.
 */
export async function getCardsForSet(prisma: PrismaClient, setId: string) {
  await getSet(prisma, setId);
  return listCardsBySet(prisma, setId);
}

/**
 * Searches cards using validated input.
 */
export async function searchCatalogCards(prisma: PrismaClient, input: CardSearchInput) {
  return searchCards(prisma, input);
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
