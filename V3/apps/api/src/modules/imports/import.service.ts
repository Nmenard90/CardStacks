/**
 * File: import.service.ts
 * Purpose:
 *   Orchestrates a collection import from uploaded bytes to job completion.
 *
 * Why this file exists:
 *   Routes should stay thin and repositories should stay dumb. The sequence
 *   (create job -> parse -> plan -> record parse errors -> apply -> finalize
 *   counts) is a business workflow, and it lives here so it can be tested
 *   with a mocked Prisma client.
 */

import type { PrismaClient } from "@prisma/client";
import { validationError } from "../../errors/app-error.js";
import { parseImportFile, planImport } from "./import.parser.js";
import { applyImportPlan } from "./import.repository.js";

/**
 * Summary returned to the client when an import finishes.
 */
export interface ImportSummary {
  importJobId: string;
  rowsTotal: number;
  rowsImported: number;
  rowsFailed: number;
  errors: { rowNumber: number; message: string }[];
}

/**
 * Runs a full import for one uploaded file.
 *
 * @param prisma - Prisma client.
 * @param userId - Authenticated owner of the collection.
 * @param filename - Original filename, stored for the user's import history.
 * @param buffer - Uploaded file bytes (CSV or XLSX).
 * @return Summary with counts and row-level errors.
 */
export async function runCollectionImport(prisma: PrismaClient, userId: string, filename: string, buffer: Buffer): Promise<ImportSummary> {
  const rawRows = parseImportFile(buffer);

  // Failing before creating a job keeps the import history free of junk
  // entries from empty or headerless files.
  if (rawRows.length === 0) {
    throw validationError("The file has no data rows. The first sheet must have a header row (card_id, condition, quantity, ...) and at least one row.", { filename });
  }

  const plan = planImport(rawRows);

  const job = await prisma.importJob.create({
    data: {
      userId,
      status: "RUNNING",
      filename,
      rowsTotal: plan.rowsTotal
    }
  });

  // Parse-stage errors (bad condition text, missing card_id) are recorded the
  // same way as database-stage errors so the user sees one unified error list.
  for (const error of plan.errors) {
    await prisma.importError.create({
      data: {
        importJobId: job.id,
        rowNumber: error.rowNumber,
        message: error.message,
        rawRow: error.rawRow
      }
    });
  }

  const applied = await applyImportPlan(prisma, userId, job.id, plan.rows);

  const rowsFailed = plan.errors.length + applied.failed;
  // "Imported" counts source rows, not merged entries, so the numbers the
  // user sees always add up to the rows in their file.
  const rowsImported = plan.rowsTotal - rowsFailed;

  await prisma.importJob.update({
    where: { id: job.id },
    data: {
      status: rowsFailed === 0 ? "SUCCESS" : rowsImported > 0 ? "PARTIAL_FAILURE" : "FAILED",
      rowsImported,
      rowsFailed,
      finishedAt: new Date()
    }
  });

  const errors = await prisma.importError.findMany({
    where: { importJobId: job.id },
    orderBy: { rowNumber: "asc" },
    select: { rowNumber: true, message: true }
  });

  return { importJobId: job.id, rowsTotal: plan.rowsTotal, rowsImported, rowsFailed, errors };
}
