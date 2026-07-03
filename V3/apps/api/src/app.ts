/**
 * File: app.ts
 * Purpose:
 *   Builds the Fastify API app by registering plugins and routes.
 *
 * Why this file exists:
 *   Server startup should stay thin and readable. This file describes the API
 *   composition without hiding business logic inside the entry point.
 */

import Fastify from "fastify";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "./config/env.js";
import { registerErrorHandler } from "./errors/error-handler.js";
import { createAuthPlugin } from "./plugins/auth.plugin.js";
import { prismaPlugin } from "./plugins/prisma.plugin.js";
import { registerSecurityPlugins } from "./plugins/security.plugin.js";
import { registerAdminRoutes } from "./modules/admin/admin.routes.js";
import { registerBinderRoutes } from "./modules/binders/binders.routes.js";
import { registerCatalogRoutes } from "./modules/catalog/catalog.routes.js";
import { registerCollectionRoutes } from "./modules/collection/collection.routes.js";
import { registerExportRoutes } from "./modules/exports/export.routes.js";
import { registerHealthRoutes } from "./modules/health/health.routes.js";
import { registerImportRoutes } from "./modules/imports/import.routes.js";
import { registerMasterSetRoutes } from "./modules/masterSets/master-sets.routes.js";
import { registerPriceRoutes } from "./modules/prices/prices.routes.js";
import { registerUserRoutes } from "./modules/users/users.routes.js";

/**
 * Creates and configures the Fastify app.
 */
export async function buildApp(env: AppEnv): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: env.LOG_LEVEL } });

  registerErrorHandler(app);

  await registerSecurityPlugins(app, env);
  await app.register(prismaPlugin);
  await app.register(createAuthPlugin(env));

  await registerHealthRoutes(app);
  await registerUserRoutes(app);
  await registerCatalogRoutes(app, env);
  await registerCollectionRoutes(app);
  await registerMasterSetRoutes(app);
  await registerBinderRoutes(app);
  await registerPriceRoutes(app);
  await registerImportRoutes(app, env);
  await registerExportRoutes(app);
  await registerAdminRoutes(app);

  return app;
}
