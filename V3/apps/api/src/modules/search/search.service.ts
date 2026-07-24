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
import { findAmbiguityCandidates, probeAmbiguousSets, searchCards, type CardSearchInput } from "./search.repository.js";

/**
 * Searches cards using validated input and returns a bounded page plus
 * whether the match set is an ambiguous cross-set collector-number result.
 *
 * A bare collector-number search is checked against a bounded probe (see
 * `probeAmbiguousSets`) rather than one results page — a page boundary must
 * never hide a second set's matches or make an ambiguous card unreachable,
 * but proving ambiguity only requires knowing whether at least two distinct
 * sets match, not loading every match. When ambiguous, the full candidate
 * set is still returned as a normal bounded, paginated page (grouped by set)
 * with an accurate total — never an unbounded dump capped at an arbitrary
 * row limit.
 */
export async function searchCatalogCards(prisma: PrismaClient, input: CardSearchInput) {
  if (isNumberOnlySearch(input)) {
    const probe = await probeAmbiguousSets(prisma, input);

    if (isAmbiguousNumberSearch(input, probe)) {
      const { items, total } = await findAmbiguityCandidates(prisma, input);

      return {
        items,
        pageInfo: buildPageInfo(input.page, input.limit, total),
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
