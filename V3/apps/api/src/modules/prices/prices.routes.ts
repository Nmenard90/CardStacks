/**
 * File: prices.routes.ts
 * Purpose:
 *   Defines routes for current and historical card prices.
 *
 * Why this file exists:
 *   Collection value, trade analysis, and future charts need price access that
 *   is separate from the collection routes.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateInput } from "../../utils/validate.js";

const cardParamsSchema = z.object({ cardId: z.string().min(1).max(120) });
const historyQuerySchema = z.object({ variantId: z.string().uuid().optional(), condition: z.string().optional(), source: z.string().optional(), limit: z.coerce.number().int().min(1).max(500).default(90) });

/**
 * Registers price routes.
 */
export async function registerPriceRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/cards/:cardId/prices/current", async (request) => {
    const { cardId } = validateInput(cardParamsSchema, request.params);
    const prices = await app.prisma.marketPriceCurrent.findMany({ where: { cardId }, include: { variant: true }, orderBy: { fetchedAt: "desc" } });
    return { data: prices };
  });

  app.get("/api/v1/cards/:cardId/prices/history", async (request) => {
    const { cardId } = validateInput(cardParamsSchema, request.params);
    const query = validateInput(historyQuerySchema, request.query);
    const history = await app.prisma.marketPriceSnapshot.findMany({
      where: {
        cardId,
        variantId: query.variantId,
        condition: query.condition as never,
        source: query.source
      },
      orderBy: { capturedAt: "desc" },
      take: query.limit
    });
    return { data: history };
  });
}
