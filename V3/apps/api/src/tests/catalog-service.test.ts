/**
 * File: catalog-service.test.ts
 * Purpose:
 *   Tests bounded set/card browsing and card-detail DTO safety with a
 *   mocked Prisma client.
 *
 * Why this file exists:
 *   Pagination bounds and not-found handling are easy to silently regress,
 *   and card detail must never leak raw provider JSON or internal source
 *   identifiers to a public response (FR-CAT-010).
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { getCardDetail, getCardsForSet, getSet, getSets } from "../modules/catalog/catalog.service.js";

function fakePrisma(overrides: {
  sets?: unknown[];
  setsTotal?: number;
  set?: unknown;
  cards?: unknown[];
  cardsTotal?: number;
  card?: unknown;
}) {
  const findManyArgs: any[] = [];
  const findUniqueArgs: any[] = [];

  const prisma = {
    set: {
      findMany: vi.fn(async (args: any) => {
        findManyArgs.push(["set", args]);
        return overrides.sets ?? [];
      }),
      count: vi.fn(async () => overrides.setsTotal ?? 0),
      findUnique: vi.fn(async (args: any) => {
        findUniqueArgs.push(["set", args]);
        return overrides.set ?? null;
      })
    },
    card: {
      findMany: vi.fn(async (args: any) => {
        findManyArgs.push(["card", args]);
        return overrides.cards ?? [];
      }),
      count: vi.fn(async () => overrides.cardsTotal ?? 0),
      findUnique: vi.fn(async (args: any) => {
        findUniqueArgs.push(["card", args]);
        return overrides.card ?? null;
      })
    }
  } as unknown as PrismaClient;

  return { prisma, findManyArgs, findUniqueArgs };
}

describe("getSets", () => {
  it("returns a bounded page with pagination metadata", async () => {
    const { prisma, findManyArgs } = fakePrisma({ sets: [{ id: "sv1" }, { id: "sv2" }], setsTotal: 130 });

    const result = await getSets(prisma, { page: 2, limit: 25 });

    expect(result.items).toHaveLength(2);
    expect(result.pageInfo).toEqual({ page: 2, limit: 25, total: 130, totalPages: 6 });
    expect(findManyArgs[0][1]).toMatchObject({ skip: 25, take: 25 });
  });
});

describe("getSet", () => {
  it("throws a not-found app error for a missing set", async () => {
    const { prisma } = fakePrisma({ set: null });
    await expect(getSet(prisma, "missing-set")).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("returns the set when found", async () => {
    const { prisma } = fakePrisma({ set: { id: "sv1", name: "Scarlet & Violet" } });
    await expect(getSet(prisma, "sv1")).resolves.toEqual({ id: "sv1", name: "Scarlet & Violet" });
  });
});

describe("getCardsForSet", () => {
  it("rejects browsing an unknown set before querying cards", async () => {
    const { prisma } = fakePrisma({ set: null });
    await expect(getCardsForSet(prisma, "missing-set", { page: 1, limit: 25 })).rejects.toMatchObject({
      code: "NOT_FOUND"
    });
  });

  it("returns a bounded, paginated page of cards scoped to the set", async () => {
    const { prisma, findManyArgs } = fakePrisma({
      set: { id: "sv1" },
      cards: [{ id: "sv1-1" }],
      cardsTotal: 258
    });

    const result = await getCardsForSet(prisma, "sv1", { page: 1, limit: 25 });

    expect(result.pageInfo).toEqual({ page: 1, limit: 25, total: 258, totalPages: 11 });
    const cardFindMany = findManyArgs.find(([model]) => model === "card")!;
    expect(cardFindMany[1]).toMatchObject({ where: { setId: "sv1" }, skip: 0, take: 25 });
  });
});

describe("getCardDetail", () => {
  it("throws a not-found app error for a missing card", async () => {
    const { prisma } = fakePrisma({ card: null });
    await expect(getCardDetail(prisma, "missing-card")).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });

  it("requests an explicit select that excludes raw provider JSON and internal source ids", async () => {
    const { prisma, findUniqueArgs } = fakePrisma({ card: { id: "sv1-1", name: "Sprigatito" } });

    await getCardDetail(prisma, "sv1-1");

    const [, args] = findUniqueArgs.find(([model]) => model === "card")!;
    const serializedSelect = JSON.stringify(args.select);
    expect(serializedSelect).not.toContain("rawJson");
    expect(serializedSelect).not.toContain("sourceProductId");
    expect(serializedSelect).not.toContain("sourceSkuId");
  });
});
