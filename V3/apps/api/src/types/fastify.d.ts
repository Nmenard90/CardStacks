/**
 * File: fastify.d.ts
 * Purpose:
 *   Adds project-specific properties to Fastify request and app types.
 *
 * Why this file exists:
 *   Auth and Prisma are attached to Fastify so routes can use them safely.
 */

import "fastify";
import type { PrismaClient } from "@prisma/client";

interface CurrentUser {
  id: string;
  email: string;
  role: "USER" | "ADMIN";
}

declare module "fastify" {
  interface FastifyInstance {
    prisma: PrismaClient;
  }

  interface FastifyRequest {
    currentUser?: CurrentUser;
  }
}
