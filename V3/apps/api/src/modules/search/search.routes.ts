/**
 * File: search.routes.ts
 * Purpose:
 *   Defines the HTTP route for card search.
 *
 * Why this file exists:
 *   Search is rate-limited separately from ordinary catalog browsing because
 *   it is the most expensive read endpoint in the catalog.
 */

import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../../config/env.js";
import { validateInput } from "../../utils/validate.js";
import { searchCardsQuerySchema } from "./search.schemas.js";
import { searchCatalogCards } from "./search.service.js";

/**
 * Registers card search routes.
 */
export async function registerSearchRoutes(app: FastifyInstance, env: AppEnv): Promise<void> {
  app.get(
    "/api/v1/search/cards",
    {
      config: {
        rateLimit: {
          max: env.RATE_LIMIT_SEARCH_MAX,
          timeWindow: env.RATE_LIMIT_SEARCH_WINDOW
        }
      }
    },
    async (request) => {
      const query = validateInput(searchCardsQuerySchema, request.query);
      return { data: await searchCatalogCards(app.prisma, query) };
    }
  );
}
