/**
 * File: search.repository.ts
 * Purpose:
 *   Runs the card search query against name, set, and collector-number
 *   filters.
 *
 * Why this file exists:
 *   Search combines multiple optional filters into one bounded, paginated
 *   query. Isolating the `where` construction keeps the service focused on
 *   ambiguity/response shaping instead of Prisma query mechanics.
 *
 * Indexing note (follow-up: CAT-303):
 *   The name filter uses `startsWith` against the indexed `normalizedName`
 *   column, which Postgres can serve from a plain B-tree index. A normal
 *   B-tree index cannot accelerate an arbitrary substring ("contains")
 *   search — that requires a trigram/full-text index, which is a database
 *   migration out of scope for this task. Until that migration lands, name
 *   search is intentionally prefix-only rather than pretending an
 *   unindexed substring scan is production-safe at catalog scale. CAT-303
 *   is the tracked, approval-required follow-up for that migration.
 *
 *   The set-name filter is different: it filters the small `sets` dimension
 *   table (bounded by total set count, not card count), so a `contains`
 *   scan there stays cheap without a trigram index.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import { normalizeCardName, parseCollectorNumberInt, type SearchCandidate } from "@tcg/shared";

export interface CardSearchInput {
  q?: string;
  setId?: string;
  setName?: string;
  number?: string;
  page: number;
  limit: number;
}

/**
 * Searches cards by name prefix, set, and/or collector number, returning a
 * bounded page plus the total match count for pagination metadata.
 *
 * Performance:
 *   Every filter that is applied uses an indexed column (`normalizedName`
 *   prefix, `setId`, `number`/`numberInt`) or the small `sets` table
 *   (`setName`). This never loads the full catalog into Node memory to
 *   filter it.
 */
export async function searchCards(prisma: PrismaClient, input: CardSearchInput) {
  const where = buildSearchWhere(input);
  const skip = (input.page - 1) * input.limit;

  const [items, total] = await Promise.all([
    prisma.card.findMany({
      where,
      orderBy: [{ name: "asc" }, { setId: "asc" }, { numberInt: "asc" }, { number: "asc" }],
      skip,
      take: input.limit,
      select: cardSearchSelect()
    }),
    prisma.card.count({ where })
  ]);

  return { items, total };
}

/**
 * Reports whether a bare collector-number search's matches span more than
 * one set, reading only enough rows to prove or disprove that — never the
 * full match list.
 *
 * `distinct: ["setId"]` collapses each set to one row, so a `take` of 2 is
 * sufficient: either fewer than two distinct sets exist (not ambiguous), or
 * at least two do (ambiguous), regardless of how many sets actually match.
 */
export async function probeAmbiguousSets(prisma: PrismaClient, input: CardSearchInput): Promise<SearchCandidate[]> {
  return prisma.card.findMany({
    where: buildSearchWhere(input),
    distinct: ["setId"],
    orderBy: [{ setId: "asc" }],
    take: 2,
    select: { id: true, setId: true }
  });
}

/**
 * Fetches a bounded, paginated page of matches for an ambiguous
 * collector-number search, ordered by set then name so same-set matches
 * stay grouped, plus the true (uncapped) total match count for pagination
 * metadata.
 */
export async function findAmbiguityCandidates(prisma: PrismaClient, input: CardSearchInput) {
  const where = buildSearchWhere(input);
  const skip = (input.page - 1) * input.limit;

  const [items, total] = await Promise.all([
    prisma.card.findMany({
      where,
      orderBy: [{ setId: "asc" }, { name: "asc" }],
      skip,
      take: input.limit,
      select: cardSearchSelect()
    }),
    prisma.card.count({ where })
  ]);

  return { items, total };
}

/**
 * Builds the Prisma `where` clause for a card search request.
 *
 * Number matching:
 *   - Alphanumeric numbers ("TG10") match the `number` column exactly.
 *   - Purely numeric numbers also match `numberInt`, so "80" and "080" find
 *     the same card without assuming numbers are globally unique.
 */
function buildSearchWhere(input: CardSearchInput): Prisma.CardWhereInput {
  const conditions: Prisma.CardWhereInput[] = [];

  if (input.q) {
    conditions.push({ normalizedName: { startsWith: normalizeCardName(input.q) } });
  }

  if (input.setId) {
    conditions.push({ setId: input.setId });
  }

  if (input.setName) {
    conditions.push({ set: { name: { contains: input.setName, mode: "insensitive" } } });
  }

  if (input.number) {
    const numberInt = parseCollectorNumberInt(input.number);
    conditions.push({
      OR: numberInt === null ? [{ number: input.number }] : [{ number: input.number }, { numberInt }]
    });
  }

  return conditions.length > 0 ? { AND: conditions } : {};
}

/**
 * Provides the public card fields returned by search results.
 */
function cardSearchSelect() {
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
