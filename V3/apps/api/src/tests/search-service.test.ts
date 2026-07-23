/**
 * File: search-service.test.ts
 * Purpose:
 *   Tests card search filter combination, leading-zero/alphanumeric number
 *   matching, pagination, and cross-set ambiguity detection.
 *
 * Why this file exists:
 *   Search is the primary way collectors find a card, and collector numbers
 *   are not globally unique (FR-CAT-005/006/007). These behaviors must be
 *   provably correct without a live database.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { searchCatalogCards } from "../modules/search/search.service.js";

function fakePrisma(cards: Record<string, unknown>[]) {
  const findManyArgs: any[] = [];

  const prisma = {
    card: {
      findMany: vi.fn(async (args: any) => {
        findManyArgs.push(args);
        return cards;
      }),
      count: vi.fn(async () => cards.length)
    }
  } as unknown as PrismaClient;

  return { prisma, findManyArgs };
}

describe("searchCatalogCards", () => {
  it("matches a purely numeric collector number regardless of leading zeros", async () => {
    const { prisma, findManyArgs } = fakePrisma([{ id: "sv1-80", setId: "sv1", number: "080" }]);

    await searchCatalogCards(prisma, { number: "80", page: 1, limit: 25 });

    const where = findManyArgs[0].where;
    expect(where).toEqual({ AND: [{ OR: [{ number: "80" }, { numberInt: 80 }] }] });
  });

  it("matches an alphanumeric collector number exactly, without numeric coercion", async () => {
    const { prisma, findManyArgs } = fakePrisma([{ id: "sv1-tg10", setId: "sv1", number: "TG10" }]);

    await searchCatalogCards(prisma, { number: "TG10", page: 1, limit: 25 });

    const where = findManyArgs[0].where;
    expect(where).toEqual({ AND: [{ OR: [{ number: "TG10" }] }] });
  });

  it("combines name, set, and number filters with AND", async () => {
    const { prisma, findManyArgs } = fakePrisma([]);

    await searchCatalogCards(prisma, { q: "Charizard", setId: "sv1", number: "80", page: 1, limit: 25 });

    const where = findManyArgs[0].where;
    expect(where).toEqual({
      AND: [
        { normalizedName: { startsWith: "charizard" } },
        { setId: "sv1" },
        { OR: [{ number: "80" }, { numberInt: 80 }] }
      ]
    });
  });

  it("reports ambiguous when a number-only search spans multiple sets", async () => {
    const { prisma } = fakePrisma([
      { id: "sv1-80", setId: "sv1" },
      { id: "swsh1-80", setId: "swsh1" }
    ]);

    const result = await searchCatalogCards(prisma, { number: "80", page: 1, limit: 25 });

    expect(result.ambiguous).toBe(true);
  });

  it("is not ambiguous once a set filter narrows a number search to one set", async () => {
    const { prisma } = fakePrisma([{ id: "sv1-80", setId: "sv1" }]);

    const result = await searchCatalogCards(prisma, { number: "80", setId: "sv1", page: 1, limit: 25 });

    expect(result.ambiguous).toBe(false);
  });

  it("returns bounded pagination metadata for the result page", async () => {
    const { prisma } = fakePrisma([{ id: "sv1-1", setId: "sv1" }]);

    const result = await searchCatalogCards(prisma, { q: "pikachu", page: 3, limit: 10 });

    expect(result.pageInfo).toEqual({ page: 3, limit: 10, total: 1, totalPages: 1 });
  });
});
