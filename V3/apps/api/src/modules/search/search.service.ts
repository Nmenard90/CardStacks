/**
 * File: search.service.ts
 * Purpose:
 *   Runs card search and reports when collector-number results are
 *   ambiguous across sets.
 *
 * Why this file exists:
 *   Collector numbers are not globally unique. The service — not the route
 *   or the web client — is the single place that decides whether a set of
 *   results counts as "ambiguous" (FR-CAT-005, FR-CAT-007).
 */

import type { PrismaClient } from "@prisma/client";
import { buildPageInfo, isAmbiguousNumberSearch } from "@tcg/shared";
import { searchCards, type CardSearchInput } from "./search.repository.js";

/**
 * Searches cards using validated input and returns a bounded page plus
 * whether the match set is an ambiguous cross-set collector-number result.
 */
export async function searchCatalogCards(prisma: PrismaClient, input: CardSearchInput) {
  const { items, total } = await searchCards(prisma, input);

  return {
    items,
    pageInfo: buildPageInfo(input.page, input.limit, total),
    ambiguous: isAmbiguousNumberSearch(input, items)
  };
}
