/**
 * File: client.ts
 * Purpose:
 *   Creates a Prisma client for packages that need direct database access.
 *
 * Why this file exists:
 *   Keeping Prisma client creation in one place avoids scattered connection
 *   setup and makes future logging or tracing easier.
 */

import { PrismaClient } from "@prisma/client";

/**
 * Creates a new Prisma client.
 *
 * Performance:
 *   Long-running apps should create one client and reuse it instead of making
 *   a new connection for every request.
 */
export function createPrismaClient(): PrismaClient {
  return new PrismaClient();
}
