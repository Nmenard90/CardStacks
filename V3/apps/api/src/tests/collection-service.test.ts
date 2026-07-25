/**
 * File: collection-service.test.ts
 * Purpose:
 *   Tests collection quick add, explicit add, bulk add, quantity
 *   increment/decrement, update, and removal with a mocked Prisma client.
 *
 * Why this file exists:
 *   These behaviors directly protect inventory integrity: deterministic
 *   bucket merging (COL-401), cross-card variant rejection (COL-402),
 *   correct not-found/conflict error mapping (COL-403), decrement/removal
 *   boundaries, ownership scoping, and per-row bulk-add outcomes
 *   (FR-BULK-007) are all easy to silently regress.
 */

import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { CARD_CONDITIONS } from "@tcg/shared";
import {
  adjustCollectionQuantity,
  bulkAddToCollection,
  getOwnedCollection,
  quickAddToCollection,
  removeCollectionItem,
  updateCollectionItem
} from "../modules/collection/collection.service.js";

function knownRequestError(code: string) {
  return new Prisma.PrismaClientKnownRequestError("Simulated Prisma error", { code, clientVersion: "6.7.0" });
}

interface FakePrismaOptions {
  variant?: unknown;
  collectionItems?: unknown[];
  collectionItemsTotal?: number;
  findFirstResult?: unknown;
  findUniqueResult?: unknown;
  upsertResult?: unknown;
  updateResult?: unknown;
  updateError?: unknown;
  deleteResult?: unknown;
  deleteError?: unknown;
}

function fakePrisma(options: FakePrismaOptions = {}) {
  const calls: Record<string, any[]> = {};
  const record = (name: string, args: unknown) => {
    (calls[name] ??= []).push(args);
  };

  const collectionItem = {
    findMany: vi.fn(async (args: any) => {
      record("findMany", args);
      return options.collectionItems ?? [];
    }),
    count: vi.fn(async (args: any) => {
      record("count", args);
      return options.collectionItemsTotal ?? options.collectionItems?.length ?? 0;
    }),
    findFirst: vi.fn(async (args: any) => {
      record("findFirst", args);
      return options.findFirstResult ?? null;
    }),
    findUnique: vi.fn(async (args: any) => {
      record("findUnique", args);
      return options.findUniqueResult ?? null;
    }),
    upsert: vi.fn(async (args: any) => {
      record("upsert", args);
      return options.upsertResult ?? { id: "item-1" };
    }),
    update: vi.fn(async (args: any) => {
      record("update", args);
      if (options.updateError) throw options.updateError;
      return options.updateResult ?? { id: "item-1", ...args.data };
    }),
    delete: vi.fn(async (args: any) => {
      record("delete", args);
      if (options.deleteError) throw options.deleteError;
      return options.deleteResult ?? { id: "item-1" };
    }),
    groupBy: vi.fn(async () => [])
  };

  const cardVariant = {
    findFirst: vi.fn(async (args: any) => {
      record("variantFindFirst", args);
      return options.variant === undefined ? { id: args.where.id, cardId: args.where.cardId } : options.variant;
    })
  };

  const purchaseLot = {
    create: vi.fn(async (args: any) => {
      record("purchaseLotCreate", args);
      return { id: "lot-1" };
    })
  };

  const prisma = {
    collectionItem,
    cardVariant,
    purchaseLot,
    $transaction: vi.fn(async (fn: any) => fn(prisma))
  } as unknown as PrismaClient;

  return { prisma, calls };
}

describe("getOwnedCollection", () => {
  it("always scopes the query to the requesting user (ownership isolation)", async () => {
    const { prisma, calls } = fakePrisma();

    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "updatedAt", direction: "desc" });

    expect(calls.findMany[0].where).toMatchObject({ AND: [{ userId: "user-a" }] });
  });

  it("scopes a different user to their own rows, not another user's", async () => {
    const { prisma, calls } = fakePrisma();

    await getOwnedCollection(prisma, "user-b", { page: 1, limit: 25, sort: "updatedAt", direction: "desc" });

    expect(calls.findMany[0].where.AND[0]).toEqual({ userId: "user-b" });
  });

  it("combines set, name/number, condition, variant, and storage filters with AND", async () => {
    const { prisma, calls } = fakePrisma();

    await getOwnedCollection(prisma, "user-a", {
      page: 1,
      limit: 25,
      setId: "sv1",
      q: "Charizard",
      number: "080",
      condition: "NEAR_MINT",
      variantKey: "HOLOFOIL",
      storageLocation: "Binder 1",
      sort: "updatedAt",
      direction: "desc"
    });

    expect(calls.findMany[0].where).toEqual({
      AND: [
        { userId: "user-a" },
        { card: { setId: "sv1" } },
        { card: { normalizedName: { startsWith: "charizard" } } },
        { card: { OR: [{ number: "080" }, { numberInt: 80 }] } },
        { condition: "NEAR_MINT" },
        { variant: { variantKey: "HOLOFOIL" } },
        { storageLocation: "Binder 1" }
      ]
    });
  });

  it("returns bounded pagination metadata", async () => {
    const { prisma } = fakePrisma({ collectionItems: [{ id: "item-1" }], collectionItemsTotal: 57 });

    const result = await getOwnedCollection(prisma, "user-a", { page: 2, limit: 25, sort: "updatedAt", direction: "desc" });

    expect(result.pageInfo).toEqual({ page: 2, limit: 25, total: 57, totalPages: 3 });
  });

  it("sorts by name", async () => {
    const { prisma, calls } = fakePrisma();
    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "name", direction: "asc" });
    expect(calls.findMany[0].orderBy).toEqual([{ card: { name: "asc" } }, { id: "asc" }]);
  });

  it("sorts by number using numeric-then-alphanumeric tiebreak columns", async () => {
    const { prisma, calls } = fakePrisma();
    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "number", direction: "asc" });
    expect(calls.findMany[0].orderBy).toEqual([{ card: { numberInt: "asc" } }, { card: { number: "asc" } }, { id: "asc" }]);
  });

  it("sorts by quantity", async () => {
    const { prisma, calls } = fakePrisma();
    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "quantity", direction: "desc" });
    expect(calls.findMany[0].orderBy).toEqual([{ quantity: "desc" }, { id: "desc" }]);
  });

  it("sorts by condition", async () => {
    const { prisma, calls } = fakePrisma();
    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "condition", direction: "asc" });
    expect(calls.findMany[0].orderBy).toEqual([{ condition: "asc" }, { id: "asc" }]);
  });

  it("sorts by updatedAt with an id tie-breaker so rows updated in the same instant keep a stable order across pages", async () => {
    const { prisma, calls } = fakePrisma();
    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "updatedAt", direction: "desc" });
    expect(calls.findMany[0].orderBy).toEqual([{ updatedAt: "desc" }, { id: "desc" }]);
  });

  it("appends a final id tie-breaker to every sort field so tied values never duplicate or skip rows across adjacent pages", async () => {
    const { prisma, calls } = fakePrisma();

    await getOwnedCollection(prisma, "user-a", { page: 1, limit: 25, sort: "quantity", direction: "asc" });
    const orderBy = calls.findMany[0].orderBy as Array<Record<string, unknown>>;

    expect(orderBy[orderBy.length - 1]).toEqual({ id: "asc" });
  });
});

describe("quickAddToCollection", () => {
  it("rejects a variant that does not belong to the card (cross-card variant rejection)", async () => {
    const { prisma } = fakePrisma({ variant: null });

    await expect(
      quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-2", condition: "NEAR_MINT", quantity: 1 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });
  });

  it("normalizes a blank storage location to the canonical default bucket key", async () => {
    const { prisma, calls } = fakePrisma();

    await quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity: 3 });

    const upsertArgs = calls.upsert[0];
    expect(upsertArgs.where.userId_cardId_variantId_condition_storageLocation.storageLocation).toBe("default");
  });

  it("merges into a fresh bucket using the submitted quantity", async () => {
    const { prisma, calls } = fakePrisma();

    await quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity: 3 });

    expect(calls.upsert[0].update.quantity).toBe(3);
  });

  it("increments (not overwrites) an existing matching bucket (deterministic bucket merging)", async () => {
    const { prisma, calls } = fakePrisma({ findUniqueResult: { quantity: 5 } });

    await quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity: 3 });

    expect(calls.upsert[0].update.quantity).toBe(8);
  });

  it("rejects merging into a near-limit bucket instead of silently exceeding the quantity ceiling", async () => {
    const { prisma, calls } = fakePrisma({ findUniqueResult: { quantity: 9999 } });

    await expect(
      quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity: 2 })
    ).rejects.toMatchObject({ code: "VALIDATION_ERROR", statusCode: 400 });

    expect(calls.upsert).toBeUndefined();
  });

  it("records a purchase lot when paid price/purchase date are supplied without corrupting aggregate quantity math", async () => {
    const { prisma, calls } = fakePrisma();

    await quickAddToCollection(prisma, {
      userId: "user-a",
      cardId: "card-1",
      variantId: "variant-1",
      condition: "NEAR_MINT",
      quantity: 2,
      pricePaidEach: 12.5,
      purchasedAt: "2026-01-01"
    });

    expect(calls.purchaseLotCreate).toHaveLength(1);
    expect(calls.purchaseLotCreate[0].data).toMatchObject({ quantity: 2, pricePaidEach: 12.5, pricePaidTotal: 25 });
    expect(calls.upsert[0].update.quantity).toBe(2);
  });

  it("skips the purchase lot write when no paid price or purchase date is supplied", async () => {
    const { prisma, calls } = fakePrisma();

    await quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity: 1 });

    expect(calls.purchaseLotCreate).toBeUndefined();
  });

  it.each(CARD_CONDITIONS)("accepts the %s condition", async (condition) => {
    const { prisma, calls } = fakePrisma();

    await quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition, quantity: 1 });

    expect(calls.upsert[0].where.userId_cardId_variantId_condition_storageLocation.condition).toBe(condition);
  });

  it.each([1, 10000])("accepts a boundary quantity of %i", async (quantity) => {
    const { prisma, calls } = fakePrisma();

    await quickAddToCollection(prisma, { userId: "user-a", cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT", quantity });

    expect(calls.upsert[0].create.quantity).toBe(quantity);
  });
});

describe("updateCollectionItem", () => {
  it("deletes the bucket when quantity is set to 0 (quantity-zero-means-remove convention)", async () => {
    const { prisma, calls } = fakePrisma();

    const result = await updateCollectionItem(prisma, "user-a", "item-1", { quantity: 0 });

    expect(result).toEqual({ deleted: true });
    expect(calls.delete[0].where).toEqual({ id: "item-1", userId: "user-a" });
  });

  it("normalizes a cleared storage location to the canonical default instead of null", async () => {
    const { prisma, calls } = fakePrisma();

    await updateCollectionItem(prisma, "user-a", "item-1", { storageLocation: "   " });

    expect(calls.update[0].data.storageLocation).toBe("default");
  });

  it("allows correcting condition on an existing bucket", async () => {
    const { prisma, calls } = fakePrisma();

    await updateCollectionItem(prisma, "user-a", "item-1", { condition: "DAMAGED" });

    expect(calls.update[0].data.condition).toBe("DAMAGED");
  });

  it("maps a missing row or mismatched owner (P2025) to 404, not a generic failure", async () => {
    const { prisma } = fakePrisma({ updateError: knownRequestError("P2025") });

    await expect(updateCollectionItem(prisma, "user-a", "item-1", { notes: "x" })).rejects.toMatchObject({
      code: "NOT_FOUND",
      statusCode: 404
    });
  });

  it("maps a unique-constraint conflict (P2002) to 409, distinct from not-found", async () => {
    const { prisma } = fakePrisma({ updateError: knownRequestError("P2002") });

    await expect(updateCollectionItem(prisma, "user-a", "item-1", { storageLocation: "Binder 2" })).rejects.toMatchObject({
      code: "CONFLICT",
      statusCode: 409
    });
  });

  it("rethrows an unexpected database error instead of misreporting it as not-found", async () => {
    const { prisma } = fakePrisma({ updateError: new Error("connection reset") });

    await expect(updateCollectionItem(prisma, "user-a", "item-1", { notes: "x" })).rejects.toThrow("connection reset");
  });
});

describe("removeCollectionItem", () => {
  it("removes an owned item scoped by id and userId", async () => {
    const { prisma, calls } = fakePrisma();

    await removeCollectionItem(prisma, "user-a", "item-1");

    expect(calls.delete[0].where).toEqual({ id: "item-1", userId: "user-a" });
  });

  it("maps a missing row or another user's item to 404 (cross-user access denial)", async () => {
    const { prisma } = fakePrisma({ deleteError: knownRequestError("P2025") });

    await expect(removeCollectionItem(prisma, "user-a", "item-1")).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });
});

describe("adjustCollectionQuantity", () => {
  it("increments an existing bucket", async () => {
    const { prisma, calls } = fakePrisma({ findFirstResult: { id: "item-1", userId: "user-a", quantity: 2 } });

    const result = await adjustCollectionQuantity(prisma, "user-a", "item-1", 3);

    expect(calls.update[0].data.quantity).toBe(5);
    expect(result).toMatchObject({ id: "item-1" });
  });

  it("decrements without going below zero", async () => {
    const { prisma, calls } = fakePrisma({ findFirstResult: { id: "item-1", userId: "user-a", quantity: 5 } });

    await adjustCollectionQuantity(prisma, "user-a", "item-1", -2);

    expect(calls.update[0].data.quantity).toBe(3);
  });

  it("deletes the bucket when a decrement reaches exactly zero (decrement-to-removal boundary)", async () => {
    const { prisma, calls } = fakePrisma({ findFirstResult: { id: "item-1", userId: "user-a", quantity: 2 } });

    const result = await adjustCollectionQuantity(prisma, "user-a", "item-1", -2);

    expect(result).toEqual({ deleted: true });
    expect(calls.delete[0].where).toEqual({ id: "item-1" });
  });

  it("rejects a decrement that would go negative instead of clamping or deleting", async () => {
    const { prisma, calls } = fakePrisma({ findFirstResult: { id: "item-1", userId: "user-a", quantity: 2 } });

    await expect(adjustCollectionQuantity(prisma, "user-a", "item-1", -5)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      statusCode: 400
    });
    expect(calls.delete).toBeUndefined();
    expect(calls.update).toBeUndefined();
  });

  it("rejects an increment past the collection quantity ceiling", async () => {
    const { prisma } = fakePrisma({ findFirstResult: { id: "item-1", userId: "user-a", quantity: 9999 } });

    await expect(adjustCollectionQuantity(prisma, "user-a", "item-1", 10)).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
  });

  it("reports not-found for a missing item or another user's item (cross-user access denial)", async () => {
    const { prisma } = fakePrisma({ findFirstResult: null });

    await expect(adjustCollectionQuantity(prisma, "user-a", "item-1", 1)).rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
  });
});

describe("bulkAddToCollection", () => {
  it("saves valid rows and reports per-row failures without aborting the batch (partial save failure)", async () => {
    const variantQueue: unknown[] = [
      { id: "variant-1", cardId: "card-1" },
      null,
      { id: "variant-3", cardId: "card-3" }
    ];
    const upsertOutcomes: unknown[] = [{ id: "item-1" }, knownRequestError("P2002"), { id: "item-3" }];

    const prisma = {
      cardVariant: { findFirst: vi.fn(async () => variantQueue.shift()) },
      collectionItem: {
        findUnique: vi.fn(async () => null),
        upsert: vi.fn(async () => {
          const outcome = upsertOutcomes.shift();
          if (outcome instanceof Error) throw outcome;
          return outcome;
        })
      },
      purchaseLot: { create: vi.fn(async () => ({ id: "lot-1" })) },
      $transaction: vi.fn(async (fn: any) => fn(prisma))
    } as unknown as PrismaClient;

    const rows = [
      { cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT" as const, quantity: 1 },
      { cardId: "card-2", variantId: "variant-2", condition: "NEAR_MINT" as const, quantity: 1 },
      { cardId: "card-3", variantId: "variant-3", condition: "NEAR_MINT" as const, quantity: 1 }
    ];

    const result = await bulkAddToCollection(prisma, "user-a", rows);

    expect(result.results[0]).toMatchObject({ index: 0, ok: true, itemId: "item-1" });
    expect(result.results[1]).toMatchObject({ index: 1, ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(result.results[2]).toMatchObject({ index: 2, ok: false, error: { code: "CONFLICT" } });
    expect(result.savedCount).toBe(1);
    expect(result.failedCount).toBe(2);
  });

  it("reports a per-row ceiling failure without aborting the rest of the batch (merging into a near-limit bucket)", async () => {
    const { prisma } = fakePrisma({ findUniqueResult: { quantity: 9999 } });

    const rows = [
      { cardId: "card-1", variantId: "variant-1", condition: "NEAR_MINT" as const, quantity: 2 },
      { cardId: "card-2", variantId: "variant-2", condition: "NEAR_MINT" as const, quantity: 1 }
    ];

    const result = await bulkAddToCollection(prisma, "user-a", rows);

    expect(result.results[0]).toMatchObject({ index: 0, ok: false, error: { code: "VALIDATION_ERROR" } });
    expect(result.results[1]).toMatchObject({ index: 1, ok: true, itemId: "item-1" });
    expect(result.savedCount).toBe(1);
    expect(result.failedCount).toBe(1);
  });
});
