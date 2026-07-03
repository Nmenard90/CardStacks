/**
 * File: import.routes.ts
 * Purpose:
 *   Defines routes for collection imports.
 *
 * Why this file exists:
 *   High-volume collectors need spreadsheet import, but bad rows must create
 *   row-level errors instead of silently corrupting inventory.
 */

import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";

/**
 * Registers import routes.
 */
export async function registerImportRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  app.post("/api/v1/imports/collection", {
    config: {
      rateLimit: {
        max: env.RATE_LIMIT_IMPORT_MAX,
        timeWindow: env.RATE_LIMIT_IMPORT_WINDOW
      }
    }
  }, async (request) => {
    await app.requireAuth(request);

    const importJob = await app.prisma.importJob.create({
      data: {
        userId: request.currentUser!.id,
        status: "PENDING",
        filename: "upload-not-yet-wired"
      }
    });

    return {
      data: {
        importJobId: importJob.id,
        message: "Import job created. Multipart CSV/XLSX parsing should be wired in the next implementation chunk."
      }
    };
  });
}
