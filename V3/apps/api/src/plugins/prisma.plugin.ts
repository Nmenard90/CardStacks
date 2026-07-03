/**
 * File: prisma.plugin.ts
 * Purpose:
 *   Attaches Prisma to the Fastify app.
 *
 * Why this file exists:
 *   Database access should be created once and reused by every route.
 */

import fp from "fastify-plugin";
import { PrismaClient } from "@prisma/client";

/**
 * Registers a shared Prisma client and closes it when the API shuts down.
 */
export const prismaPlugin = fp(async (app) => {
  const prisma = new PrismaClient();

  app.decorate("prisma", prisma);

  app.addHook("onClose", async () => {
    await prisma.$disconnect();
  });
});
