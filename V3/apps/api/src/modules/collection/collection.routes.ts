/**
 * File: collection.routes.ts
 * Purpose:
 *   Defines API routes for adding, updating, removing, and listing collection cards.
 *
 * Why this file exists:
 *   Collection management is the core loop of the app.
 */

import type { FastifyInstance } from "fastify";
import { validateInput } from "../../utils/validate.js";
import { collectionItemIdParamsSchema, quickAddSchema, updateCollectionItemSchema } from "./collection.schemas.js";
import { getCollection, getCollectionSummary, quickAddToCollection, removeCollectionItem, updateCollectionItem } from "./collection.service.js";

/**
 * Registers collection routes.
 */
export async function registerCollectionRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/collection", async (request) => {
    await app.requireAuth(request);
    return { data: await getCollection(app.prisma, request.currentUser!.id) };
  });

  app.get("/api/v1/collection/summary", async (request) => {
    await app.requireAuth(request);
    return { data: await getCollectionSummary(app.prisma, request.currentUser!.id) };
  });

  app.post("/api/v1/collection/quick-add", async (request) => {
    await app.requireAuth(request);
    const input = validateInput(quickAddSchema, request.body);
    return { data: await quickAddToCollection(app.prisma, { ...input, userId: request.currentUser!.id }) };
  });

  app.patch("/api/v1/collection/items/:itemId", async (request) => {
    await app.requireAuth(request);
    const params = validateInput(collectionItemIdParamsSchema, request.params);
    const input = validateInput(updateCollectionItemSchema, request.body);
    return { data: await updateCollectionItem(app.prisma, request.currentUser!.id, params.itemId, input) };
  });

  app.delete("/api/v1/collection/items/:itemId", async (request) => {
    await app.requireAuth(request);
    const params = validateInput(collectionItemIdParamsSchema, request.params);
    return { data: await removeCollectionItem(app.prisma, request.currentUser!.id, params.itemId) };
  });
}
