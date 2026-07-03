/**
 * File: export.routes.ts
 * Purpose:
 *   Defines routes for collection exports.
 *
 * Why this file exists:
 *   Collectors need to move their data in and out of the app using common
 *   spreadsheet formats.
 */

import type { FastifyInstance } from "fastify";

/**
 * Registers export routes.
 */
export async function registerExportRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/exports/collection.csv", async (request, reply) => {
    await app.requireAuth(request);
    const rows = await app.prisma.collectionItem.findMany({
      where: { userId: request.currentUser!.id },
      include: { card: { include: { set: true } }, variant: true }
    });

    const header = "setId,setName,cardId,cardName,number,variantId,variant,condition,quantity,storageLocation\n";
    const body = rows.map((row) => [row.card.setId, row.card.set.name, row.cardId, row.card.name, row.card.number, row.variantId, row.variant.displayName, row.condition, row.quantity, row.storageLocation ?? ""].map(csvEscape).join(",")).join("\n");

    reply.header("content-type", "text/csv");
    reply.header("content-disposition", "attachment; filename=collection.csv");
    return `${header}${body}\n`;
  });

  app.get("/api/v1/exports/collection.xlsx", async (request) => {
    await app.requireAuth(request);
    return {
      data: {
        message: "XLSX export route placeholder. Install ExcelJS and stream workbook here before launch.",
        nextStep: "Implement streaming XLSX writer to avoid high memory usage."
      }
    };
  });
}

/**
 * Escapes a single CSV cell safely.
 */
function csvEscape(value: unknown): string {
  const text = String(value ?? "");
  return `"${text.replaceAll('"', '""')}"`;
}
