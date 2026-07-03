/**
 * File: catalog.routes.ts
 * Purpose:
 *   Defines HTTP routes for sets, cards, variants, and search.
 *
 * Why this file exists:
 *   Web, mobile, and desktop clients need one reliable API for catalog data.
 */

import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { validateInput } from "../../utils/validate.js";
import { cardIdParamsSchema, searchCardsQuerySchema, setIdParamsSchema } from "./catalog.schemas.js";
import { getCardDetail, getCardsForSet, getSet, getSets, searchCatalogCards } from "./catalog.service.js";

/**
 * Registers catalog routes.
 */
export async function registerCatalogRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  app.get("/api/v1/sets", async () => ({ data: await getSets(app.prisma) }));

  app.get("/api/v1/sets/:setId", async (request) => {
    const params = validateInput(setIdParamsSchema, request.params);
    return { data: await getSet(app.prisma, params.setId) };
  });

  app.get("/api/v1/sets/:setId/cards", async (request) => {
    const params = validateInput(setIdParamsSchema, request.params);
    return { data: await getCardsForSet(app.prisma, params.setId) };
  });

  app.get("/api/v1/search/cards", {
    config: {
      rateLimit: {
        max: env.RATE_LIMIT_SEARCH_MAX,
        timeWindow: env.RATE_LIMIT_SEARCH_WINDOW
      }
    }
  }, async (request) => {
    const query = validateInput(searchCardsQuerySchema, request.query);
    return { data: await searchCatalogCards(app.prisma, query) };
  });

  app.get("/api/v1/cards/:cardId", async (request) => {
    const params = validateInput(cardIdParamsSchema, request.params);
    return { data: await getCardDetail(app.prisma, params.cardId) };
  });

  app.get("/api/v1/cards/:cardId/variants", async (request) => {
    const params = validateInput(cardIdParamsSchema, request.params);
    const card = await getCardDetail(app.prisma, params.cardId);
    return { data: card.variants };
  });
}
