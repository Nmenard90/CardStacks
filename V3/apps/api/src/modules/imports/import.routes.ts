/**
 * File: import.routes.ts
 * Purpose:
 *   Defines routes for collection imports.
 *
 * Why this file exists:
 *   High-volume collectors need spreadsheet import, but bad rows must create
 *   row-level errors instead of silently corrupting inventory.
 */

import multipart from "@fastify/multipart";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { validationError } from "../../errors/app-error.js";
import { runCollectionImport } from "./import.service.js";

/**
 * Upload cap for import files.
 *
 * Why 10 MB:
 *   A 10 MB XLSX holds well over 100k rows — beyond any personal collection —
 *   while keeping memory use per request bounded on small Railway instances.
 */
const MAX_IMPORT_FILE_BYTES = 10 * 1024 * 1024;

/**
 * Registers import routes.
 */
export async function registerImportRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  // Registered here (not app-wide) because imports are the only multipart
  // surface; every other route stays JSON-only and rejects file bodies.
  await app.register(multipart, {
    limits: { fileSize: MAX_IMPORT_FILE_BYTES, files: 1 }
  });

  app.post("/api/v1/imports/collection", {
    config: {
      rateLimit: {
        max: env.RATE_LIMIT_IMPORT_MAX,
        timeWindow: env.RATE_LIMIT_IMPORT_WINDOW
      }
    }
  }, async (request) => {
    await app.requireAuth(request);

    const upload = await request.file();

    if (!upload) {
      throw validationError("No file was uploaded. Send the CSV or XLSX file as multipart form-data in a field named \"file\".");
    }

    // toBuffer() enforces the fileSize limit and throws when exceeded, so an
    // oversized upload cannot exhaust memory before we notice.
    const buffer = await upload.toBuffer();

    const summary = await runCollectionImport(app.prisma, request.currentUser!.id, upload.filename, buffer);

    return { data: summary };
  });
}
