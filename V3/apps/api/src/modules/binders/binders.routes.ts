/**
 * File: binders.routes.ts
 * Purpose:
 *   Defines routes for online binders and public sharing.
 *
 * Why this file exists:
 *   Collectors need visual binders and shareable links without exposing their
 *   private account data.
 */

import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { forbiddenError, notFoundError } from "../../errors/app-error.js";
import { validateInput } from "../../utils/validate.js";

const binderParamsSchema = z.object({ binderId: z.string().uuid() });
const shareParamsSchema = z.object({ shareSlug: z.string().min(8).max(120) });
const createBinderSchema = z.object({ name: z.string().min(1).max(120), description: z.string().max(1000).optional(), pocketSize: z.number().int().min(1).max(12).default(9) });
const slotParamsSchema = z.object({ binderId: z.string().uuid(), pageNumber: z.coerce.number().int().min(1), slotNumber: z.coerce.number().int().min(1) });
const putSlotSchema = z.object({ cardId: z.string().min(1), variantId: z.string().uuid(), condition: z.enum(["NEAR_MINT", "LIGHTLY_PLAYED", "MODERATELY_PLAYED", "HEAVILY_PLAYED", "DAMAGED"]).optional(), quantity: z.number().int().min(1).max(99).default(1), note: z.string().max(500).optional() });

/**
 * Registers binder routes.
 */
export async function registerBinderRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/binders", async (request) => {
    await app.requireAuth(request);
    const binders = await app.prisma.binder.findMany({ where: { userId: request.currentUser!.id }, orderBy: { updatedAt: "desc" } });
    return { data: binders };
  });

  app.post("/api/v1/binders", async (request) => {
    await app.requireAuth(request);
    const input = validateInput(createBinderSchema, request.body);
    const binder = await app.prisma.binder.create({ data: { ...input, userId: request.currentUser!.id } });
    return { data: binder };
  });

  app.get("/api/v1/binders/:binderId", async (request) => {
    await app.requireAuth(request);
    const { binderId } = validateInput(binderParamsSchema, request.params);
    const binder = await app.prisma.binder.findUnique({ where: { id: binderId }, include: { slots: { include: { card: true, variant: true } } } });

    if (!binder) {
      throw notFoundError("Binder was not found.", { binderId });
    }

    if (binder.userId !== request.currentUser!.id) {
      throw forbiddenError("You cannot view another user's private binder.");
    }

    return { data: binder };
  });

  app.put("/api/v1/binders/:binderId/slots/:pageNumber/:slotNumber", async (request) => {
    await app.requireAuth(request);
    const params = validateInput(slotParamsSchema, request.params);
    const input = validateInput(putSlotSchema, request.body);

    const binder = await app.prisma.binder.findUnique({ where: { id: params.binderId } });
    if (!binder || binder.userId !== request.currentUser!.id) {
      throw notFoundError("Binder was not found for this user.", { binderId: params.binderId });
    }

    const slot = await app.prisma.binderSlot.upsert({
      where: { binderId_pageNumber_slotNumber: params },
      update: input,
      create: { ...params, ...input }
    });

    return { data: slot };
  });

  app.delete("/api/v1/binders/:binderId/slots/:pageNumber/:slotNumber", async (request) => {
    await app.requireAuth(request);
    const params = validateInput(slotParamsSchema, request.params);
    const binder = await app.prisma.binder.findUnique({ where: { id: params.binderId } });

    if (!binder || binder.userId !== request.currentUser!.id) {
      throw notFoundError("Binder was not found for this user.", { binderId: params.binderId });
    }

    await app.prisma.binderSlot.delete({ where: { binderId_pageNumber_slotNumber: params } });
    return { data: { deleted: true } };
  });

  app.post("/api/v1/binders/:binderId/share", async (request) => {
    await app.requireAuth(request);
    const { binderId } = validateInput(binderParamsSchema, request.params);
    const binder = await app.prisma.binder.findUnique({ where: { id: binderId } });

    if (!binder || binder.userId !== request.currentUser!.id) {
      throw notFoundError("Binder was not found for this user.", { binderId });
    }

    const updated = await app.prisma.binder.update({ where: { id: binderId }, data: { visibility: "UNLISTED", shareSlug: binder.shareSlug ?? randomUUID() } });
    return { data: updated };
  });

  app.get("/api/v1/public/binders/:shareSlug", async (request) => {
    const { shareSlug } = validateInput(shareParamsSchema, request.params);
    const binder = await app.prisma.binder.findUnique({ where: { shareSlug }, include: { slots: { include: { card: true, variant: true } } } });

    if (!binder || binder.visibility === "PRIVATE") {
      throw notFoundError("Public binder was not found.", { shareSlug });
    }

    return { data: binder };
  });
}
