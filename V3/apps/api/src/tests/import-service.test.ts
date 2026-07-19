/**
 * File: import-service.test.ts
 * Purpose:
 *   Tests the import workflow and database application with a mocked Prisma.
 *
 * Why this file exists:
 *   The service owns job bookkeeping (counts, statuses) and the repository
 *   owns the increment-upsert. Both must be provably correct without a live
 *   database so the check runs on every push.
 */

import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { CardCondition } from "@prisma/client";
import { runCollectionImport } from "../modules/imports/import.service.js";
import { applyImportPlan } from "../modules/imports/import.repository.js";

/**
 * Builds a mocked PrismaClient good enough for the import paths.
 *
 * Why hand-rolled instead of a mocking library:
 *   The import code touches four models with simple calls; an explicit fake
 *   keeps the test readable and fails loudly when the code touches something
 *   new and unmocked.
 */
function fakePrisma(options: { variantsByCard: Record<string, { id: string; variantKey: string }[]> }) {
  const importErrors: unknown[] = [];
  const upserts: any[] = [];
  const jobUpdates: any[] = [];

  const tx = {
    cardVariant: {
      findMany: vi.fn(async ({ where }: any) => options.variantsByCard[where.cardId] ?? [])
    },
    collectionItem: {
      upsert: vi.fn(async (args: any) => { upserts.push(args); return {}; })
    }
  };

  const prisma = {
    importJob: {
      create: vi.fn(async ({ data }: any) => ({ id: "job-1", ...data })),
      update: vi.fn(async (args: any) => { jobUpdates.push(args); return {}; })
    },
    importError: {
      create: vi.fn(async ({ data }: any) => { importErrors.push(data); return data; }),
      findMany: vi.fn(async () => importErrors.map((error: any, index) => ({ rowNumber: error.rowNumber ?? index, message: error.message })))
    },
    $transaction: vi.fn(async (fn: (t: typeof tx) => Promise<void>) => fn(tx))
  } as unknown as PrismaClient;

  return { prisma, tx, upserts, importErrors, jobUpdates };
}

/**
 * Builds a minimal CSV buffer for end-to-end service tests.
 */
function csv(lines: string[]): Buffer {
  return Buffer.from(lines.join("\n"), "utf8");
}

describe("applyImportPlan", () => {
  it("upserts with a quantity increment on the condition-scoped unique key", async () => {
    const { prisma, upserts } = fakePrisma({ variantsByCard: { "sv1-25": [{ id: "var-1", variantKey: "holo" }] } });

    const result = await applyImportPlan(prisma, "user-1", "job-1", [
      { cardId: "sv1-25", variantKey: null, condition: CardCondition.NEAR_MINT, quantity: 4, storageLocation: null, notes: null, sourceRows: [2] }
    ]);

    expect(result).toEqual({ imported: 1, failed: 0 });
    expect(upserts).toHaveLength(1);
    expect(upserts[0].where.userId_cardId_variantId_condition_storageLocation.condition).toBe(CardCondition.NEAR_MINT);
    expect(upserts[0].update.quantity).toEqual({ increment: 4 });
  });

  it("requires variant_key when a card has multiple variants", async () => {
    const { prisma, importErrors } = fakePrisma({
      variantsByCard: { "sv1-25": [{ id: "var-1", variantKey: "holo" }, { id: "var-2", variantKey: "reverse-holo" }] }
    });

    const result = await applyImportPlan(prisma, "user-1", "job-1", [
      { cardId: "sv1-25", variantKey: null, condition: CardCondition.NEAR_MINT, quantity: 1, storageLocation: null, notes: null, sourceRows: [2] }
    ]);

    expect(result).toEqual({ imported: 0, failed: 1 });
    expect((importErrors[0] as any).message).toContain("variant_key column is required");
  });

  it("records an error for unknown cards without stopping later rows", async () => {
    const { prisma, importErrors } = fakePrisma({ variantsByCard: { "sv1-25": [{ id: "var-1", variantKey: "holo" }] } });

    const result = await applyImportPlan(prisma, "user-1", "job-1", [
      { cardId: "missing-card", variantKey: null, condition: CardCondition.DAMAGED, quantity: 1, storageLocation: null, notes: null, sourceRows: [2] },
      { cardId: "sv1-25", variantKey: "holo", condition: CardCondition.NEAR_MINT, quantity: 2, storageLocation: null, notes: null, sourceRows: [3] }
    ]);

    expect(result).toEqual({ imported: 1, failed: 1 });
    expect((importErrors[0] as any).message).toContain("not found in the catalog");
  });
});

describe("runCollectionImport", () => {
  it("imports a valid file and finalizes the job as SUCCESS", async () => {
    const { prisma, jobUpdates } = fakePrisma({ variantsByCard: { "sv1-25": [{ id: "var-1", variantKey: "holo" }] } });

    const summary = await runCollectionImport(prisma, "user-1", "cards.csv", csv([
      "card_id,condition,quantity",
      "sv1-25,NM,2",
      "sv1-25,nm,3"
    ]));

    expect(summary.rowsTotal).toBe(2);
    expect(summary.rowsImported).toBe(2);
    expect(summary.rowsFailed).toBe(0);
    expect(jobUpdates[0].data.status).toBe("SUCCESS");
  });

  it("finalizes as PARTIAL_FAILURE when some rows fail and counts add up", async () => {
    const { prisma, jobUpdates } = fakePrisma({ variantsByCard: { "sv1-25": [{ id: "var-1", variantKey: "holo" }] } });

    const summary = await runCollectionImport(prisma, "user-1", "cards.csv", csv([
      "card_id,condition,quantity",
      "sv1-25,NM,2",
      "sv1-30,pristine,1"
    ]));

    expect(summary.rowsImported).toBe(1);
    expect(summary.rowsFailed).toBe(1);
    expect(summary.rowsImported + summary.rowsFailed).toBe(summary.rowsTotal);
    expect(jobUpdates[0].data.status).toBe("PARTIAL_FAILURE");
  });

  it("rejects empty files before creating an import job", async () => {
    const { prisma } = fakePrisma({ variantsByCard: {} });

    await expect(runCollectionImport(prisma, "user-1", "empty.csv", csv([""]))).rejects.toThrow("no data rows");
    expect((prisma.importJob.create as any).mock.calls).toHaveLength(0);
  });
});
