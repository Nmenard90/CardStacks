/**
 * File: sync-prices.ts
 * Purpose:
 *   Syncs current prices and stores historical snapshots.
 *
 * Why this file exists:
 *   Price history must exist from day one so charts and trade analysis can be
 *   built later without losing historical data.
 */

import type { CardCondition, PrismaClient } from "@prisma/client";
import type { WorkerEnv } from "../config/env.js";

/**
 * Creates a visible sync run for price syncing.
 *
 * Current limitation:
 *   Real SKU-to-card mapping must be finished after testing the user's exact
 *   `tcg.io` provider response fixtures.
 */
export async function syncPrices(prisma: PrismaClient, env: WorkerEnv): Promise<void> {
  const syncRun = await prisma.syncRun.create({ data: { jobType: "price_sync", status: "RUNNING", source: env.OPEN_TCG_PRICE_SOURCE_NAME } });

  try {
    await prisma.syncError.create({
      data: {
        syncRunId: syncRun.id,
        severity: "WARNING",
        entityType: "price_provider",
        message: "Price sync scaffold ran. Real Open TCG SKU mapping must be completed with actual provider fixtures before production price writes."
      }
    });

    await prisma.syncRun.update({ where: { id: syncRun.id }, data: { status: "PARTIAL_FAILURE", finishedAt: new Date(), recordsSeen: 0, recordsUpdated: 0, recordsFailed: 1, errorSummary: "Provider fixture mapping pending." } });
  } catch (error) {
    await prisma.syncRun.update({ where: { id: syncRun.id }, data: { status: "FAILED", finishedAt: new Date(), errorSummary: error instanceof Error ? error.message : "Unknown price sync failure" } });
    throw error;
  }

  // The run is recorded as PARTIAL_FAILURE above, but the job as a whole must
  // still fail the process: PRICE-703 (real SKU mapping) is unimplemented, so
  // this invocation never writes a price. Throwing here — outside the try
  // block above, so it does not overwrite the PARTIAL_FAILURE status with
  // FAILED — makes main() set a nonzero exit code instead of reporting a
  // deceptive success for a job that wrote nothing.
  throw new Error(
    `Price sync recorded PARTIAL_FAILURE (syncRun ${syncRun.id}): Open TCG SKU mapping (PRICE-703) is not implemented, so no prices were written.`
  );
}

/**
 * Writes one current price and one history snapshot in a transaction.
 */
export async function writePriceSnapshot(
  prisma: PrismaClient,
  input: {
    cardId: string;
    variantId: string;
    condition: CardCondition;
    source: string;
    marketPrice?: number | null;
    lowPrice?: number | null;
    midPrice?: number | null;
    highPrice?: number | null;
    lastSoldPrice?: number | null;
    currency?: string;
  }
): Promise<void> {
  const fetchedAt = new Date();

  await prisma.$transaction([
    prisma.marketPriceCurrent.upsert({
      where: { cardId_variantId_condition_source: { cardId: input.cardId, variantId: input.variantId, condition: input.condition, source: input.source } },
      update: { ...input, fetchedAt, currency: input.currency ?? "USD" },
      create: { ...input, fetchedAt, currency: input.currency ?? "USD" }
    }),
    prisma.marketPriceSnapshot.create({
      data: { ...input, currency: input.currency ?? "USD", capturedAt: fetchedAt }
    })
  ]);
}
