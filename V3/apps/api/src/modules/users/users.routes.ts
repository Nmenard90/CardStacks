/**
 * File: users.routes.ts
 * Purpose:
 *   Defines routes for the logged-in user's profile.
 *
 * Why this file exists:
 *   The frontend needs a safe way to get the current app user without passing
 *   user ids around manually.
 */

import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { validateInput } from "../../utils/validate.js";

const updateMeSchema = z.object({
  displayName: z.string().trim().min(1).max(120).optional()
});

/**
 * Registers profile routes.
 */
export async function registerUserRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/me", async (request) => {
    await app.requireAuth(request);

    const user = await app.prisma.appUser.findUniqueOrThrow({
      where: { id: request.currentUser!.id },
      select: { id: true, email: true, displayName: true, role: true, createdAt: true }
    });

    return { data: user };
  });

  app.patch("/api/v1/me", async (request) => {
    await app.requireAuth(request);
    const input = validateInput(updateMeSchema, request.body);

    const user = await app.prisma.appUser.update({
      where: { id: request.currentUser!.id },
      data: input,
      select: { id: true, email: true, displayName: true, role: true, updatedAt: true }
    });

    return { data: user };
  });
}
