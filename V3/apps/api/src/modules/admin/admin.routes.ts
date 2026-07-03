/**
 * File: admin.routes.ts
 * Purpose:
 *   Defines admin-only routes for sync visibility and access overrides.
 *
 * Why this file exists:
 *   The project owner needs manual premium/admin overrides and visibility into
 *   sync problems without digging through logs.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateInput } from "../../utils/validate.js";

const overrideSchema = z.object({
  userId: z.string().uuid(),
  accessLevel: z.enum(["FREE", "COLLECTOR_PRO", "VENDOR_PRO", "ADMIN_FULL"]),
  reason: z.string().min(1).max(500),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional()
});

/**
 * Registers admin routes.
 */
export async function registerAdminRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/admin/sync-runs", async (request) => {
    await app.requireAdmin(request);
    const runs = await app.prisma.syncRun.findMany({ orderBy: { startedAt: "desc" }, take: 50 });
    return { data: runs };
  });

  app.get("/api/v1/admin/sync-runs/:runId/errors", async (request) => {
    await app.requireAdmin(request);
    const params = validateInput(z.object({ runId: z.string().uuid() }), request.params);
    const errors = await app.prisma.syncError.findMany({ where: { syncRunId: params.runId }, orderBy: { createdAt: "desc" } });
    return { data: errors };
  });

  app.post("/api/v1/admin/access-overrides", async (request) => {
    await app.requireAdmin(request);
    const input = validateInput(overrideSchema, request.body);
    const override = await app.prisma.accessOverride.create({
      data: {
        userId: input.userId,
        grantedByUserId: request.currentUser!.id,
        accessLevel: input.accessLevel,
        reason: input.reason,
        startsAt: input.startsAt ? new Date(input.startsAt) : new Date(),
        endsAt: input.endsAt ? new Date(input.endsAt) : undefined,
        isActive: true
      }
    });
    return { data: override };
  });
}
