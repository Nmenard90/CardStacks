/**
 * File: health.routes.ts
 * Purpose:
 *   Defines health and status routes.
 *
 * Why this file exists:
 *   Railway and developers need a simple endpoint to confirm the API is alive.
 */

import type { FastifyInstance } from "fastify";

/**
 * Registers health check routes.
 */
export async function registerHealthRoutes(app: FastifyInstance): Promise<void> {
  app.get("/health", async () => ({ data: { status: "ok" } }));
  app.get("/api/v1/status", async () => ({ data: { status: "ok", service: "tcg-v3-api" } }));
}
