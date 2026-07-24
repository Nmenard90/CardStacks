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
import { buildPageInfo, isAmbiguousNumberSearch, isNumberOnlySearch } from "@tcg/shared";
import { findAmbiguityCandidates, searchCards, type CardSearchInput } from "./search.repository.js";

/**
 * Searches cards using validated input and returns a bounded page plus
 * whether the match set is an ambiguous cross-set collector-number result.
 *
 * A bare collector-number search is checked against its *complete* match
 * set (bounded, see `findAmbiguityCandidates`) rather than one results page
 * — a page boundary must never hide a second set's matches or make an
 * ambiguous card unreachable. When that full set turns out to span more
 * than one set, every candidate is returned unpaginated so the user can
 * choose between them; otherwise the request falls through to the normal
 * paginated search.
 */
export async function searchCatalogCards(prisma: PrismaClient, input: CardSearchInput) {
  if (isNumberOnlySearch(input)) {
    const candidates = await findAmbiguityCandidates(prisma, input);

    if (isAmbiguousNumberSearch(input, candidates)) {
      return {
        items: candidates,
        pageInfo: buildPageInfo(1, Math.max(candidates.length, 1), candidates.length),
        ambiguous: true
      };
    }
  }

  const { items, total } = await searchCards(prisma, input);

  return {
    items,
    pageInfo: buildPageInfo(input.page, input.limit, total),
    ambiguous: false
  };
}
