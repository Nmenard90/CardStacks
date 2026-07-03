/**
 * File: security.plugin.ts
 * Purpose:
 *   Registers security-related Fastify plugins.
 *
 * Why this file exists:
 *   The API needs sane browser security headers, CORS, and rate limiting from
 *   day one instead of after abuse happens.
 */

import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import type { FastifyInstance } from "fastify";
import type { AppEnv } from "../config/env.js";

/**
 * Registers CORS, security headers, and global rate limiting.
 */
export async function registerSecurityPlugins(app: FastifyInstance, env: AppEnv): Promise<void> {
  await app.register(helmet);

  await app.register(cors, {
    origin: [env.PUBLIC_WEB_URL],
    credentials: true
  });

  await app.register(rateLimit, {
    max: env.RATE_LIMIT_GENERAL_MAX,
    timeWindow: env.RATE_LIMIT_GENERAL_WINDOW,
    allowList: ["127.0.0.1"]
  });
}
