/**
 * File: catalog.routes.ts
 * Purpose:
 *   Defines HTTP routes for browsing sets, cards, and variants.
 *
 * Why this file exists:
 *   Web, mobile, and desktop clients need one reliable API for bounded
 *   catalog browsing. Card search lives in the sibling `search` module.
 */

import type { FastifyInstance } from "fastify";
import { validateInput } from "../../utils/validate.js";
import { cardIdParamsSchema, paginationQuerySchema, setIdParamsSchema } from "./catalog.schemas.js";
import { getCardDetail, getCardsForSet, getSet, getSets } from "./catalog.service.js";

/**
 * Registers catalog browsing routes.
 */
export async function registerCatalogRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/sets", async (request) => {
    const query = validateInput(paginationQuerySchema, request.query);
    return { data: await getSets(app.prisma, query) };
  });

  app.get("/api/v1/sets/:setId", async (request) => {
    const params = validateInput(setIdParamsSchema, request.params);
    return { data: await getSet(app.prisma, params.setId) };
  });

  app.get("/api/v1/sets/:setId/cards", async (request) => {
    const params = validateInput(setIdParamsSchema, request.params);
    const query = validateInput(paginationQuerySchema, request.query);
    return { data: await getCardsForSet(app.prisma, params.setId, query) };
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
