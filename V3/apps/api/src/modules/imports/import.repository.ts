/**
 * File: import.repository.ts
 * Purpose:
 *   Applies a validated import plan to the database.
 *
 * Why this file exists:
 *   The parser decides WHAT should change; this file is the only place that
 *   decides HOW it hits Postgres. Card/variant resolution and the
 *   quantity-increment upsert live here so the condition-merge rule is
 *   enforced against real data in one transaction per row batch.
 */

import type { Prisma, PrismaClient } from "@prisma/client";
import type { ImportRowError, PlannedImportRow } from "./import.parser.js";

/**
 * Result of applying one planned row.
 */
export interface AppliedRowResult {
  ok: boolean;
  error?: ImportRowError;
}

/**
 * Resolves the CardVariant a planned row refers to.
 *
 * Resolution rules:
 *   - variantKey given: exact match on (cardId, variantKey).
 *   - variantKey empty: allowed only when the card has exactly one variant,
 *     because guessing between variants would corrupt inventory silently.
 *
 * @param tx - Prisma client or transaction.
 * @param row - Planned row to resolve.
 * @return The variant id, or a user-safe error message.
 */
async function resolveVariantId(tx: Prisma.TransactionClient, row: PlannedImportRow): Promise<{ variantId: string } | { message: string }> {
  const variants = await tx.cardVariant.findMany({
    where: { cardId: row.cardId },
    select: { id: true, variantKey: true }
  });

  if (variants.length === 0) {
    return { message: `Card "${row.cardId}" was not found in the catalog.` };
  }

  if (row.variantKey) {
    const match = variants.find((variant) => variant.variantKey === row.variantKey);
    return match
      ? { variantId: match.id }
      : { message: `Variant "${row.variantKey}" does not exist for card "${row.cardId}". Known variants: ${variants.map((v) => v.variantKey).join(", ")}.` };
  }

  if (variants.length === 1) {
    return { variantId: variants[0].id };
  }

  return { message: `Card "${row.cardId}" has ${variants.length} variants; the variant_key column is required for it. Known variants: ${variants.map((v) => v.variantKey).join(", ")}.` };
}

/**
 * Applies planned rows for one user, recording row-level errors.
 *
 * Why per-row transactions instead of one big transaction:
 *   The product rule (see import.routes.ts header) is that bad rows must
 *   create row-level errors instead of failing the whole file. One giant
 *   transaction would roll back 900 good rows over 1 bad one.
 *
 * @param prisma - Prisma client.
 * @param userId - Owner of the collection.
 * @param importJobId - Job the errors attach to.
 * @param rows - Validated, merged rows from planImport.
 * @return Counts of imported and failed rows.
 */
export async function applyImportPlan(prisma: PrismaClient, userId: string, importJobId: string, rows: PlannedImportRow[]): Promise<{ imported: number; failed: number }> {
  let imported = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        const resolved = await resolveVariantId(tx, row);

        if ("message" in resolved) {
          throw new RowError(resolved.message);
        }

        // Upsert against the same unique key the parser merged on. The
        // increment (not overwrite) implements "same condition adds together"
        // for cards the user already owns.
        await tx.collectionItem.upsert({
          where: {
            userId_cardId_variantId_condition_storageLocation: {
              userId,
              cardId: row.cardId,
              variantId: resolved.variantId,
              condition: row.condition,
              storageLocation: row.storageLocation ?? ""
            }
          },
          create: {
            userId,
            cardId: row.cardId,
            variantId: resolved.variantId,
            condition: row.condition,
            quantity: row.quantity,
            storageLocation: row.storageLocation,
            notes: row.notes
          },
          update: {
            quantity: { increment: row.quantity },
            ...(row.notes ? { notes: row.notes } : {})
          }
        });
      });
      imported += 1;
    } catch (error) {
      failed += 1;
      // User-facing message for rule violations; generic message otherwise so
      // internal errors never leak database details into the UI.
      const message = error instanceof RowError ? error.message : "Row failed to import due to an internal error.";
      await prisma.importError.create({
        data: {
          importJobId,
          rowNumber: row.sourceRows[0],
          message,
          rawRow: { cardId: row.cardId, variantKey: row.variantKey, condition: row.condition, quantity: row.quantity, mergedRows: row.sourceRows }
        }
      });
    }
  }

  return { imported, failed };
}

/**
 * Error type for expected, user-fixable row problems.
 *
 * Why a dedicated class:
 *   Lets the catch block distinguish "your file is wrong" (show the message)
 *   from "our code is wrong" (hide details, keep counts honest).
 */
export class RowError extends Error {}
