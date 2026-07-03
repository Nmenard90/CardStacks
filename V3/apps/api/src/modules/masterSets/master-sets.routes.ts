/**
 * File: master-sets.routes.ts
 * Purpose:
 *   Defines routes for set completion and missing-card tracking.
 *
 * Why this file exists:
 *   Master set builders need to know what cards and variants are missing.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateInput } from "../../utils/validate.js";

const paramsSchema = z.object({ setId: z.string().min(1).max(80) });

/**
 * Registers master set routes.
 */
export async function registerMasterSetRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/master-sets/:setId/progress", async (request) => {
    await app.requireAuth(request);
    const { setId } = validateInput(paramsSchema, request.params);
    const userId = request.currentUser!.id;

    const totalCards = await app.prisma.card.count({ where: { setId } });
    const ownedCardRows = await app.prisma.collectionItem.findMany({
      where: { userId, card: { setId } },
      distinct: ["cardId"],
      select: { cardId: true }
    });

    const requiredVariants = await app.prisma.cardVariant.count({ where: { card: { setId }, isMasterSetVariant: true } });
    const ownedVariantRows = await app.prisma.collectionItem.findMany({
      where: { userId, card: { setId }, variant: { isMasterSetVariant: true } },
      distinct: ["variantId"],
      select: { variantId: true }
    });

    return {
      data: {
        setId,
        totalCards,
        ownedCards: ownedCardRows.length,
        missingCards: Math.max(totalCards - ownedCardRows.length, 0),
        requiredVariants,
        ownedVariants: ownedVariantRows.length,
        missingVariants: Math.max(requiredVariants - ownedVariantRows.length, 0)
      }
    };
  });

  app.get("/api/v1/master-sets/:setId/missing", async (request) => {
    await app.requireAuth(request);
    const { setId } = validateInput(paramsSchema, request.params);
    const userId = request.currentUser!.id;

    const owned = await app.prisma.collectionItem.findMany({ where: { userId, card: { setId } }, distinct: ["cardId"], select: { cardId: true } });
    const ownedIds = owned.map((row) => row.cardId);

    const missing = await app.prisma.card.findMany({
      where: { setId, id: { notIn: ownedIds } },
      orderBy: [{ numberInt: "asc" }, { number: "asc" }],
      select: { id: true, name: true, number: true, imageSmall: true }
    });

    return { data: missing };
  });

  app.get("/api/v1/master-sets/:setId/missing-variants", async (request) => {
    await app.requireAuth(request);
    const { setId } = validateInput(paramsSchema, request.params);
    const userId = request.currentUser!.id;

    const owned = await app.prisma.collectionItem.findMany({ where: { userId, card: { setId } }, distinct: ["variantId"], select: { variantId: true } });
    const ownedIds = owned.map((row) => row.variantId);

    const missing = await app.prisma.cardVariant.findMany({
      where: { card: { setId }, isMasterSetVariant: true, id: { notIn: ownedIds } },
      orderBy: [{ card: { numberInt: "asc" } }, { displayName: "asc" }],
      include: { card: { select: { id: true, name: true, number: true, imageSmall: true } } }
    });

    return { data: missing };
  });
}
